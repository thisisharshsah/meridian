//! End-to-end tests through the real HTTP surface.
//!
//! The point of these is tenant isolation. SQLite has no row-level security, so
//! the guarantee that org A can never see org B's data rests entirely on every
//! statement in the repository being scoped by `org_id`. That is exactly the
//! kind of invariant that holds until someone adds one endpoint — so it is
//! asserted here against the assembled router, not against the repo functions.

use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePoolOptions;
use tower::ServiceExt;

use crate::config::Config;
use crate::state::AppState;

async fn test_app() -> (Router, AppState) {
    // One shared in-memory connection: `sqlite::memory:` gives each connection
    // its own database, so the pool is pinned to a single connection.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite");

    sqlx::query("PRAGMA foreign_keys = ON;").execute(&pool).await.unwrap();
    crate::db::migrate(&pool).await.expect("migrations");

    let mut config = Config::from_env();
    config.jwt_secret = "test-secret-for-isolation-tests".into();

    let registry = crate::modules::registry();
    registry.validate().expect("registry");

    let state = AppState {
        pool,
        config: Arc::new(config),
        registry: Arc::new(registry),
    };

    (crate::api_router(state.clone()), state)
}

async fn call(app: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let res = app.clone().oneshot(req).await.expect("request");
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 4 * 1024 * 1024).await.expect("body");
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

fn get(path: &str, token: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(path)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

fn send(method: &str, path: &str, token: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn anon(method: &str, path: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// Register a fresh organization and return its owner's access token.
async fn new_org(app: &Router, who: &str) -> String {
    let (status, body) = call(
        app,
        anon(
            "POST",
            "/api/auth/register",
            json!({
                "name": format!("{who} Owner"),
                "email": format!("{who}@example.test"),
                "password": "a-long-enough-password",
                "organization": format!("{who} Industries"),
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "register failed: {body}");
    body["access_token"].as_str().expect("access token").to_string()
}

#[tokio::test]
async fn one_tenant_cannot_reach_another_tenants_records() {
    let (app, _state) = test_app().await;

    let alice = new_org(&app, "alice").await;
    let bob = new_org(&app, "bob").await;

    // Alice creates an account in her own workspace.
    let (status, created) = call(
        &app,
        send(
            "POST",
            "/api/e/crm.accounts",
            &alice,
            json!({ "name": "Alice Confidential Holdings", "account_type": "customer" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "create failed: {created}");
    let id = created["id"].as_str().expect("id").to_string();

    // Alice can read it back.
    let (status, _) = call(&app, get(&format!("/api/e/crm.accounts/{id}"), &alice)).await;
    assert_eq!(status, StatusCode::OK);

    // Bob's list is empty - not "filtered on the client", genuinely empty.
    let (status, list) = call(&app, get("/api/e/crm.accounts", &bob)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["total"], json!(0), "Bob must not see Alice's records");

    // Direct fetch by id is a 404, not a 403: Bob learns nothing about whether
    // the id exists at all.
    let (status, _) = call(&app, get(&format!("/api/e/crm.accounts/{id}"), &bob)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Writes are equally blind.
    let (status, _) = call(
        &app,
        send("PATCH", &format!("/api/e/crm.accounts/{id}"), &bob, json!({ "name": "Owned" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = call(
        &app,
        send("DELETE", &format!("/api/e/crm.accounts/{id}"), &bob, Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Global search must not become the leak that the list endpoint is not.
    let (status, search) = call(&app, get("/api/search?q=Confidential", &bob)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        search["groups"].as_array().map(|g| g.len()),
        Some(0),
        "search leaked another tenant's record"
    );

    // Neither must the aggregate endpoint, which builds its own WHERE clause.
    let (status, stats) = call(
        &app,
        send("POST", "/api/stats/crm.accounts", &bob, json!({ "agg": "count" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stats["data"][0]["value"], json!(0), "stats leaked a cross-tenant count");

    // And the record is untouched for Alice after all of that.
    let (status, still) = call(&app, get(&format!("/api/e/crm.accounts/{id}"), &alice)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(still["name"], json!("Alice Confidential Holdings"));
}

#[tokio::test]
async fn audit_trail_is_scoped_to_the_tenant() {
    let (app, _state) = test_app().await;
    let alice = new_org(&app, "audit-alice").await;
    let bob = new_org(&app, "audit-bob").await;

    let (_, created) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &alice, json!({ "name": "Ledger Co" })),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_string();

    let (status, trail) = call(&app, get(&format!("/api/e/crm.accounts/{id}/audit"), &alice)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!trail["data"].as_array().unwrap().is_empty(), "creation should be audited");

    let (status, trail) = call(&app, get(&format!("/api/e/crm.accounts/{id}/audit"), &bob)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        trail["data"].as_array().unwrap().is_empty(),
        "another tenant must not read this record's history"
    );
}

#[tokio::test]
async fn requests_without_a_valid_token_are_refused() {
    let (app, _state) = test_app().await;

    for (method, path) in [
        ("GET", "/api/meta"),
        ("GET", "/api/e/crm.accounts"),
        ("POST", "/api/e/crm.accounts"),
        ("GET", "/api/search?q=anything"),
    ] {
        let (status, _) = call(&app, anon(method, path, json!({}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {path} should require auth");
    }

    // A well-formed but wrongly-signed token is not enough either.
    let forged = crate::auth::jwt::issue_access_token(
        "not-the-server-secret", "u", "o", "e@x.test", "E", 600,
    )
    .unwrap();
    let (status, _) = call(&app, get("/api/e/crm.accounts", &forged)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn document_numbers_are_unique_and_gapless_per_tenant() {
    let (app, _state) = test_app().await;
    let alice = new_org(&app, "num-alice").await;
    let bob = new_org(&app, "num-bob").await;

    let (_, acct_a) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &alice, json!({ "name": "A Customer" })),
    )
    .await;
    let (_, acct_b) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &bob, json!({ "name": "B Customer" })),
    )
    .await;

    let mut alice_numbers = Vec::new();
    for _ in 0..3 {
        let (status, inv) = call(
            &app,
            send(
                "POST",
                "/api/e/books.invoices",
                &alice,
                json!({
                    "account_id": acct_a["id"],
                    "invoice_date": "2026-01-05",
                    "due_date": "2026-02-04",
                    // A client trying to pick its own number must be ignored.
                    "number": "INV-99999",
                }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "invoice create failed: {inv}");
        alice_numbers.push(inv["number"].as_str().unwrap().to_string());
    }

    assert_eq!(alice_numbers, vec!["INV-00001", "INV-00002", "INV-00003"]);

    // Each tenant has its own sequence, so Bob also starts at one.
    let (_, inv_b) = call(
        &app,
        send(
            "POST",
            "/api/e/books.invoices",
            &bob,
            json!({
                "account_id": acct_b["id"],
                "invoice_date": "2026-01-05",
                "due_date": "2026-02-04",
            }),
        ),
    )
    .await;
    assert_eq!(inv_b["number"], json!("INV-00001"));
}

#[tokio::test]
async fn invoice_totals_and_status_are_the_servers_to_decide() {
    let (app, _state) = test_app().await;
    let token = new_org(&app, "totals").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &token, json!({ "name": "Payer Ltd" })),
    )
    .await;

    let (_, inv) = call(
        &app,
        send(
            "POST",
            "/api/e/books.invoices",
            &token,
            json!({
                "account_id": acct["id"],
                "status": "sent",
                "invoice_date": "2026-01-05",
                "due_date": "2099-01-01",
                // Nonsense totals from the client must not survive.
                "total": "999999.00",
                "amount_paid": "500000.00",
            }),
        ),
    )
    .await;
    let inv_id = inv["id"].as_str().unwrap().to_string();
    assert_eq!(inv["total"], json!(0), "client-supplied total must be discarded");
    assert_eq!(inv["amount_paid"], json!(0));

    // 3 x 100.00, 10% off, 20% tax => net 270.00, tax 54.00, total 324.00
    let (status, line) = call(
        &app,
        send(
            "POST",
            "/api/e/books.invoice_items",
            &token,
            json!({
                "invoice_id": inv_id,
                "description": "Consulting",
                "quantity": "3",
                "unit_price": "100.00",
                "discount_percent": "10",
                "tax_rate": "20",
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "line create failed: {line}");
    assert_eq!(line["line_total"], json!(27_000), "line total is net of discount, before tax");

    let (_, inv) = call(&app, get(&format!("/api/e/books.invoices/{inv_id}"), &token)).await;
    assert_eq!(inv["subtotal"], json!(30_000));
    assert_eq!(inv["discount_total"], json!(3_000));
    assert_eq!(inv["tax_total"], json!(5_400), "tax is charged after the discount");
    assert_eq!(inv["total"], json!(32_400));
    assert_eq!(inv["balance_due"], json!(32_400));
    assert_eq!(inv["status"], json!("sent"));

    // Part payment moves it to `partial`.
    call(
        &app,
        send(
            "POST",
            "/api/e/books.payments",
            &token,
            json!({
                "invoice_id": inv_id,
                "account_id": acct["id"],
                "amount": "100.00",
                "payment_date": "2026-01-10",
                "method": "cash",
            }),
        ),
    )
    .await;
    let (_, inv) = call(&app, get(&format!("/api/e/books.invoices/{inv_id}"), &token)).await;
    assert_eq!(inv["status"], json!("partial"));
    assert_eq!(inv["balance_due"], json!(22_400));

    // Settling the rest moves it to `paid`.
    call(
        &app,
        send(
            "POST",
            "/api/e/books.payments",
            &token,
            json!({
                "invoice_id": inv_id,
                "account_id": acct["id"],
                "amount": "224.00",
                "payment_date": "2026-01-12",
                "method": "bank_transfer",
            }),
        ),
    )
    .await;
    let (_, inv) = call(&app, get(&format!("/api/e/books.invoices/{inv_id}"), &token)).await;
    assert_eq!(inv["status"], json!("paid"));
    assert_eq!(inv["balance_due"], json!(0));
    assert!(inv["paid_at"].is_string());
}

/// Move a user onto a named seeded role and hand back a fresh token for them.
async fn as_role(state: &AppState, app: &Router, email: &str, role_key: &str) -> String {
    use sqlx::Row;

    let user = sqlx::query("SELECT id FROM users WHERE lower(email) = ?")
        .bind(email)
        .fetch_one(&state.pool)
        .await
        .expect("user");
    let user_id: String = user.try_get("id").unwrap();

    let m = sqlx::query("SELECT org_id FROM memberships WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&state.pool)
        .await
        .expect("membership");
    let org_id: String = m.try_get("org_id").unwrap();

    let role = sqlx::query("SELECT id FROM roles WHERE org_id = ? AND key = ?")
        .bind(&org_id)
        .bind(role_key)
        .fetch_one(&state.pool)
        .await
        .expect("role");
    let role_id: String = role.try_get("id").unwrap();

    // Drop owner status too, or the owner bypass would mask every check.
    sqlx::query("UPDATE memberships SET role_id = ?, is_owner = 0 WHERE user_id = ?")
        .bind(&role_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .unwrap();

    let _ = app;
    crate::auth::jwt::issue_access_token(
        &state.config.jwt_secret, &user_id, &org_id, email, "Role User", 600,
    )
    .unwrap()
}

#[tokio::test]
async fn a_viewer_can_read_everything_and_write_nothing() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "rbac-view").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Readable Co" })),
    )
    .await;
    let acct_id = acct["id"].as_str().unwrap().to_string();

    let viewer = as_role(&state, &app, "rbac-view@example.test", "viewer").await;

    // Reads are allowed across the suite.
    for path in ["/api/e/crm.accounts", "/api/e/books.invoices", "/api/e/hr.employees"] {
        let (status, _) = call(&app, get(path, &viewer)).await;
        assert_eq!(status, StatusCode::OK, "viewer should be able to read {path}");
    }

    // Writes are not, at any verb.
    let (status, body) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &viewer, json!({ "name": "Sneaky Co" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "viewer created a record: {body}");

    let (status, _) = call(
        &app,
        send("PATCH", &format!("/api/e/crm.accounts/{acct_id}"), &viewer, json!({ "name": "Renamed" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(
        &app,
        send("DELETE", &format!("/api/e/crm.accounts/{acct_id}"), &viewer, Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The record is untouched.
    let (_, still) = call(&app, get(&format!("/api/e/crm.accounts/{acct_id}"), &owner)).await;
    assert_eq!(still["name"], json!("Readable Co"));
}

#[tokio::test]
async fn a_role_only_sees_the_modules_it_is_granted() {
    let (app, state) = test_app().await;
    let _owner = new_org(&app, "rbac-people").await;

    // The People role grants hr.* and recruit.*, and nothing else.
    let people = as_role(&state, &app, "rbac-people@example.test", "people").await;

    let (status, meta) = call(&app, get("/api/meta", &people)).await;
    assert_eq!(status, StatusCode::OK);
    let modules: Vec<String> = meta["modules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["key"].as_str().unwrap().to_string())
        .collect();
    assert!(modules.contains(&"hr".to_string()), "People should see HR, saw {modules:?}");
    assert!(modules.contains(&"recruit".to_string()));
    assert!(!modules.contains(&"books".to_string()), "navigation offered Finance: {modules:?}");
    assert!(!modules.contains(&"crm".to_string()));

    // And the API refuses what the navigation withheld, rather than relying on
    // the browser not to ask.
    let (status, _) = call(&app, get("/api/e/books.invoices", &people)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(&app, get("/api/e/hr.employees", &people)).await;
    assert_eq!(status, StatusCode::OK);

    // Cross-module search must respect the same boundary.
    let (_, search) = call(&app, get("/api/search?q=a", &people)).await;
    for group in search["groups"].as_array().unwrap() {
        let entity = group["entity"].as_str().unwrap();
        assert!(
            entity.starts_with("hr.") || entity.starts_with("recruit.") || entity.starts_with("core."),
            "search returned `{entity}`, which this role cannot open"
        );
    }
}

#[tokio::test]
async fn only_an_owner_can_change_workspace_settings() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "rbac-settings").await;

    let (status, _) = call(
        &app,
        send("PATCH", "/api/settings/organization", &owner, json!({ "name": "Renamed Co" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let admin = as_role(&state, &app, "rbac-settings@example.test", "admin").await;
    let (status, body) = call(
        &app,
        send("PATCH", "/api/settings/organization", &admin, json!({ "name": "Hijacked" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "a non-owner admin changed the org: {body}");
}

/// Look up a seeded role's id inside an org, for building invitations.
async fn role_id(state: &AppState, org_email: &str, role_key: &str) -> String {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT r.id AS role_id
         FROM users u
         JOIN memberships m ON m.user_id = u.id
         JOIN roles r ON r.org_id = m.org_id AND r.key = ?
         WHERE lower(u.email) = ?",
    )
    .bind(role_key)
    .bind(org_email)
    .fetch_one(&state.pool)
    .await
    .expect("role");
    row.try_get("role_id").unwrap()
}

#[tokio::test]
async fn an_invitation_admits_exactly_one_person_once() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "invite-owner").await;
    let viewer_role = role_id(&state, "invite-owner@example.test", "viewer").await;

    let (status, invite) = call(
        &app,
        send(
            "POST",
            "/api/settings/invitations",
            &owner,
            json!({ "email": "Newcomer@Example.COM", "role_id": viewer_role, "title": "Analyst" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "invite failed: {invite}");
    let token = invite["token"].as_str().expect("token").to_string();
    assert_eq!(invite["email"], json!("newcomer@example.com"), "the address is normalised");

    // The raw token is never recoverable afterwards - only its digest is kept.
    let (_, listed) = call(&app, get("/api/settings/invitations", &owner)).await;
    assert!(
        listed["data"][0].get("token").is_none(),
        "a stored invitation must not expose its token"
    );

    // Anyone holding the link can read who it is for, without a session.
    let (status, preview) = call(&app, anon("GET", &format!("/api/invitations/{token}"), json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(preview["role_name"], json!("Viewer"));
    assert_eq!(preview["has_account"], json!(false));

    // Accepting creates the account and the membership together.
    let (status, accepted) = call(
        &app,
        anon(
            "POST",
            &format!("/api/invitations/{token}/accept"),
            json!({ "name": "Newcomer", "password": "a-long-enough-password" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "accept failed: {accepted}");

    // The link is spent.
    let (status, _) = call(
        &app,
        anon(
            "POST",
            &format!("/api/invitations/{token}/accept"),
            json!({ "password": "a-long-enough-password" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "an invitation must not be reusable");

    // And the new member arrives with the role they were invited as.
    let (status, session) = call(
        &app,
        anon(
            "POST",
            "/api/auth/login",
            json!({ "email": "newcomer@example.com", "password": "a-long-enough-password" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let tok = session["access_token"].as_str().unwrap();
    let (_, me) = call(&app, get("/api/auth/me", tok)).await;
    assert_eq!(me["role"], json!("viewer"));
    assert_eq!(me["is_owner"], json!(false));
}

#[tokio::test]
async fn an_invitation_cannot_take_over_an_existing_account() {
    let (app, state) = test_app().await;
    let owner_a = new_org(&app, "takeover-a").await;
    // A second workspace, whose owner already has an account elsewhere.
    let _owner_b = new_org(&app, "takeover-b").await;
    let role = role_id(&state, "takeover-a@example.test", "viewer").await;

    let (_, invite) = call(
        &app,
        send(
            "POST",
            "/api/settings/invitations",
            &owner_a,
            json!({ "email": "takeover-b@example.test", "role_id": role }),
        ),
    )
    .await;
    let token = invite["token"].as_str().unwrap().to_string();

    let (_, preview) = call(&app, anon("GET", &format!("/api/invitations/{token}"), json!({}))).await;
    assert_eq!(preview["has_account"], json!(true), "the invitee already has an account");

    // A wrong password must not mint a membership on an existing account.
    let (status, body) = call(
        &app,
        anon(
            "POST",
            &format!("/api/invitations/{token}/accept"),
            json!({ "password": "not-their-password" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // With the real password it works, and now they belong to both workspaces.
    let (status, _) = call(
        &app,
        anon(
            "POST",
            &format!("/api/invitations/{token}/accept"),
            json!({ "password": "a-long-enough-password" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, session) = call(
        &app,
        anon(
            "POST",
            "/api/auth/login",
            json!({ "email": "takeover-b@example.test", "password": "a-long-enough-password" }),
        ),
    )
    .await;
    let tok = session["access_token"].as_str().unwrap();
    let (_, me) = call(&app, get("/api/auth/me", tok)).await;
    assert_eq!(
        me["organizations"].as_array().map(|a| a.len()),
        Some(2),
        "the account should now reach both workspaces"
    );
}

#[tokio::test]
async fn only_an_owner_can_invite() {
    let (app, state) = test_app().await;
    let _owner = new_org(&app, "invite-rbac").await;
    let role = role_id(&state, "invite-rbac@example.test", "viewer").await;
    let admin = as_role(&state, &app, "invite-rbac@example.test", "admin").await;

    let (status, _) = call(
        &app,
        send(
            "POST",
            "/api/settings/invitations",
            &admin,
            json!({ "email": "someone@example.com", "role_id": role }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "a non-owner admin must not invite");
}

#[tokio::test]
async fn an_automation_fires_through_the_real_write_path() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "auto").await;

    let (status, rule) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Won deal handover",
                "entity": "crm.deals",
                "trigger": "on_update",
                "conditions": {"match":"all","rules":[
                    {"field":"stage","op":"changed_to","value":"closed_won"}
                ]},
                "actions": [
                    {"type":"set_field","field":"probability","value":"100"},
                    {"type":"create_task","subject":"Send contract for {{name}}","due_in_days":2}
                ]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "rule create failed: {rule}");

    let (_, deal) = call(
        &app,
        send(
            "POST",
            "/api/e/crm.deals",
            &owner,
            json!({ "name": "Acme rollout", "amount": "50000.00", "probability": "40" }),
        ),
    )
    .await;
    let deal_id = deal["id"].as_str().unwrap().to_string();
    // The rule is scoped to an update, so creating the deal must not fire it.
    assert_eq!(deal["probability"], json!(400_000));

    let (_, updated) = call(
        &app,
        send("PATCH", &format!("/api/e/crm.deals/{deal_id}"), &owner, json!({ "stage": "closed_won" })),
    )
    .await;

    assert_eq!(updated["probability"], json!(1_000_000), "the rule should have set probability to 100%");
    // The derived hook must re-run after the rule's write, or expected revenue
    // would still reflect the old probability.
    assert_eq!(updated["expected_revenue"], json!(5_000_000), "expected revenue follows the rule's change");

    let (_, tasks) = call(&app, get("/api/e/crm.activities?sort=-created_at", &owner)).await;
    let first = &tasks["data"][0];
    assert_eq!(first["subject"], json!("Send contract for Acme rollout"), "the template should render");
    assert_eq!(first["kind"], json!("task"));

    // Running it a second time on an already-won deal must not re-fire: the
    // stage did not change, so `changed_to` is false.
    call(
        &app,
        send("PATCH", &format!("/api/e/crm.deals/{deal_id}"), &owner, json!({ "next_step": "Chase signature" })),
    )
    .await;
    let (_, tasks) = call(&app, get("/api/e/crm.activities", &owner)).await;
    assert_eq!(tasks["total"], json!(1), "the rule fired again when nothing transitioned");
}

#[tokio::test]
async fn two_rules_cannot_trigger_each_other_forever() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "auto-loop").await;

    // Deliberately circular: each rule's action satisfies the other's condition.
    for (name, from, to) in [("A to B", "qualification", "proposal"), ("B to A", "proposal", "qualification")] {
        let (status, body) = call(
            &app,
            send(
                "POST",
                "/api/settings/automations",
                &owner,
                json!({
                    "name": name,
                    "entity": "crm.deals",
                    "trigger": "on_create_or_update",
                    "conditions": {"match":"all","rules":[{"field":"stage","op":"eq","value":from}]},
                    "actions": [{"type":"set_field","field":"stage","value":to}]
                }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    // If a rule's own write re-fired rules, this would never return.
    let (status, deal) = call(
        &app,
        send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Ping pong", "stage": "qualification" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Exactly one hop: the first rule matched and set the stage, and that write
    // did not start the cycle again.
    assert_eq!(deal["stage"], json!("proposal"));
}

#[tokio::test]
async fn a_rule_cannot_be_saved_against_fields_that_do_not_exist() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "auto-validate").await;

    // Unknown condition field.
    let (status, body) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Broken", "entity": "crm.deals", "trigger": "on_update",
                "conditions": {"rules":[{"field":"not_a_field","op":"eq","value":"x"}]},
                "actions": [{"type":"create_task","subject":"x"}]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // A server-computed field is not something a rule may set.
    let (status, body) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Broken", "entity": "crm.deals", "trigger": "on_update",
                "conditions": {"rules":[]},
                "actions": [{"type":"set_field","field":"expected_revenue","value":"1"}]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // A select compared against a value outside its options can never match.
    let (status, body) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Never", "entity": "crm.deals", "trigger": "on_update",
                "conditions": {"rules":[{"field":"stage","op":"eq","value":"banana"}]},
                "actions": [{"type":"create_task","subject":"x"}]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // An action list with nothing in it is a rule that does nothing.
    let (status, _) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Empty", "entity": "crm.deals", "trigger": "on_update",
                "conditions": {"rules":[]}, "actions": []
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn a_scheduled_action_waits_then_rechecks_before_running() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "sched").await;

    let (status, rule) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Chase signature",
                "entity": "crm.deals",
                "trigger": "on_update",
                "conditions": {"match":"all","rules":[{"field":"stage","op":"eq","value":"closed_won"}]},
                "actions": [
                    {"type":"create_task","subject":"Chase signature for {{name}}","delay_days":3}
                ]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rule}");

    let (_, deal) = call(
        &app,
        send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Big one", "amount": "10000.00" })),
    )
    .await;
    let deal_id = deal["id"].as_str().unwrap().to_string();

    call(
        &app,
        send("PATCH", &format!("/api/e/crm.deals/{deal_id}"), &owner, json!({ "stage": "closed_won" })),
    )
    .await;

    // Nothing happens yet: the action is queued, not run.
    let (_, tasks) = call(&app, get("/api/e/crm.activities", &owner)).await;
    assert_eq!(tasks["total"], json!(0), "a delayed action must not run immediately");

    let queued: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE status = 'pending'")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(queued, 1, "the action should be waiting in the queue");

    // Re-saving the record must not stack up a second follow-up.
    call(
        &app,
        send("PATCH", &format!("/api/e/crm.deals/{deal_id}"), &owner, json!({ "next_step": "ping" })),
    )
    .await;
    let queued: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE status = 'pending'")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(queued, 1, "the dedupe key should collapse the duplicate");

    // Bring it due and let the worker take it.
    sqlx::query("UPDATE jobs SET run_at = '2000-01-01T00:00:00Z'")
        .execute(&state.pool)
        .await
        .unwrap();
    crate::jobs::run_due(&state).await.unwrap();

    let (_, tasks) = call(&app, get("/api/e/crm.activities", &owner)).await;
    assert_eq!(tasks["total"], json!(1), "the scheduled action should have run");
    assert_eq!(tasks["data"][0]["subject"], json!("Chase signature for Big one"));

    let done: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE status = 'done'")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(done, 1);
}

#[tokio::test]
async fn a_scheduled_action_is_dropped_if_its_condition_stopped_holding() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "sched-recheck").await;

    call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Chase won deals",
                "entity": "crm.deals",
                "trigger": "on_update",
                "conditions": {"match":"all","rules":[{"field":"stage","op":"eq","value":"closed_won"}]},
                "actions": [{"type":"create_task","subject":"Chase","delay_days":3}]
            }),
        ),
    )
    .await;

    let (_, deal) = call(
        &app,
        send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Wobbly deal" })),
    )
    .await;
    let deal_id = deal["id"].as_str().unwrap().to_string();

    // Won, so the follow-up is queued...
    call(
        &app,
        send("PATCH", &format!("/api/e/crm.deals/{deal_id}"), &owner, json!({ "stage": "closed_won" })),
    )
    .await;
    // ...then lost again before it comes due.
    call(
        &app,
        send("PATCH", &format!("/api/e/crm.deals/{deal_id}"), &owner, json!({ "stage": "closed_lost" })),
    )
    .await;

    sqlx::query("UPDATE jobs SET run_at = '2000-01-01T00:00:00Z'")
        .execute(&state.pool)
        .await
        .unwrap();
    crate::jobs::run_due(&state).await.unwrap();

    let (_, tasks) = call(&app, get("/api/e/crm.activities", &owner)).await;
    assert_eq!(
        tasks["total"],
        json!(0),
        "the condition is re-checked when the job runs, so a lost deal is not chased"
    );
}

#[tokio::test]
async fn a_scheduled_action_from_a_disabled_rule_does_not_run() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "sched-off").await;

    let (_, rule) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Later", "entity": "crm.deals", "trigger": "on_create",
                "conditions": {"rules":[]},
                "actions": [{"type":"create_task","subject":"Later task","delay_days":1}]
            }),
        ),
    )
    .await;
    let rule_id = rule["id"].as_str().unwrap().to_string();

    call(&app, send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Whatever" }))).await;

    // Switch the rule off while its action is still waiting.
    call(
        &app,
        send("PATCH", &format!("/api/settings/automations/{rule_id}"), &owner, json!({ "is_active": false })),
    )
    .await;

    sqlx::query("UPDATE jobs SET run_at = '2000-01-01T00:00:00Z'")
        .execute(&state.pool)
        .await
        .unwrap();
    crate::jobs::run_due(&state).await.unwrap();

    let (_, tasks) = call(&app, get("/api/e/crm.activities", &owner)).await;
    assert_eq!(tasks["total"], json!(0), "turning a rule off must stop its pending work too");
}

#[tokio::test]
async fn a_recurring_profile_bills_its_schedule_without_drifting() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "recurring").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Subscriber Ltd" })),
    )
    .await;

    let (status, profile) = call(
        &app,
        send(
            "POST",
            "/api/e/books.recurring",
            &owner,
            json!({
                "name": "Month-end retainer",
                "account_id": acct["id"],
                "frequency": "monthly",
                "every_n": 1,
                // The 31st is the interesting case: it does not exist in every month.
                "start_date": "2026-01-31",
                "payment_terms_days": 30,
                "max_occurrences": 4
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "profile create failed: {profile}");
    let profile_id = profile["id"].as_str().unwrap().to_string();
    assert_eq!(
        profile["next_run_date"], json!("2026-01-31"),
        "the first billing date should be seeded from the start date"
    );

    let (_, line) = call(
        &app,
        send(
            "POST",
            "/api/e/books.recurring_items",
            &owner,
            json!({
                "recurring_profile_id": profile_id,
                "description": "Retainer",
                "quantity": "1",
                "unit_price": "1000.00",
                "tax_rate": "10"
            }),
        ),
    )
    .await;
    assert_eq!(line["line_total"], json!(100_000));

    // The template totals like any other document.
    let (_, profile) = call(&app, get(&format!("/api/e/books.recurring/{profile_id}"), &owner)).await;
    assert_eq!(profile["total"], json!(110_000), "template total includes tax");

    // Creating a due profile queues its first invoice; each generation queues
    // the next, so draining the queue catches the schedule up.
    for _ in 0..10 {
        if crate::jobs::run_due(&state).await.unwrap() == 0 {
            break;
        }
    }

    let (_, invoices) = call(
        &app,
        get("/api/e/books.invoices?sort=invoice_date&per_page=20", &owner),
    )
    .await;
    let dates: Vec<&str> = invoices["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["invoice_date"].as_str().unwrap())
        .collect();

    assert_eq!(
        dates,
        vec!["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
        "a clamped short month must not drag every later date earlier"
    );

    for r in invoices["data"].as_array().unwrap() {
        assert_eq!(r["total"], json!(110_000), "each invoice renders the template");
        assert_eq!(r["status"], json!("draft"), "auto_issue was off");
    }

    let (_, profile) = call(&app, get(&format!("/api/e/books.recurring/{profile_id}"), &owner)).await;
    assert_eq!(profile["occurrences"], json!(4));
    assert_eq!(profile["status"], json!("ended"), "it should stop at max_occurrences");
}

#[tokio::test]
async fn recurring_generation_is_idempotent_per_billing_date() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "recurring-idem").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Subscriber" })),
    )
    .await;
    let (_, profile) = call(
        &app,
        send(
            "POST",
            "/api/e/books.recurring",
            &owner,
            json!({
                "name": "Weekly", "account_id": acct["id"], "frequency": "weekly",
                "start_date": "2026-01-05", "max_occurrences": 1
            }),
        ),
    )
    .await;
    let profile_id = profile["id"].as_str().unwrap().to_string();
    call(
        &app,
        send(
            "POST",
            "/api/e/books.recurring_items",
            &owner,
            json!({ "recurring_profile_id": profile_id, "description": "Fee", "quantity": "1", "unit_price": "50.00" }),
        ),
    )
    .await;

    for _ in 0..5 {
        if crate::jobs::run_due(&state).await.unwrap() == 0 {
            break;
        }
    }

    let (_, invoices) = call(&app, get("/api/e/books.invoices", &owner)).await;
    assert_eq!(invoices["total"], json!(1));

    // Re-queueing the same billing date must not produce a second invoice.
    crate::modules::recurring::sweep_due(&state.pool).await.unwrap();
    for _ in 0..5 {
        if crate::jobs::run_due(&state).await.unwrap() == 0 {
            break;
        }
    }
    let (_, invoices) = call(&app, get("/api/e/books.invoices", &owner)).await;
    assert_eq!(invoices["total"], json!(1), "the profile was capped and must not re-bill");
}

#[tokio::test]
async fn a_paused_profile_does_not_bill() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "recurring-paused").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Subscriber" })),
    )
    .await;
    let (_, profile) = call(
        &app,
        send(
            "POST",
            "/api/e/books.recurring",
            &owner,
            json!({
                "name": "Paused", "account_id": acct["id"], "status": "paused",
                "frequency": "monthly", "start_date": "2026-01-01"
            }),
        ),
    )
    .await;
    let profile_id = profile["id"].as_str().unwrap().to_string();
    call(
        &app,
        send(
            "POST",
            "/api/e/books.recurring_items",
            &owner,
            json!({ "recurring_profile_id": profile_id, "description": "Fee", "quantity": "1", "unit_price": "10.00" }),
        ),
    )
    .await;

    crate::modules::recurring::sweep_due(&state.pool).await.unwrap();
    for _ in 0..5 {
        if crate::jobs::run_due(&state).await.unwrap() == 0 {
            break;
        }
    }

    let (_, invoices) = call(&app, get("/api/e/books.invoices", &owner)).await;
    assert_eq!(invoices["total"], json!(0), "a paused profile must not bill");
}

#[tokio::test]
async fn receivables_ageing_buckets_by_how_late_an_invoice_is() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "aging").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Slow Payer Ltd" })),
    )
    .await;

    // One invoice per bucket, dated relative to today so the test does not rot.
    let today = chrono::Utc::now().date_naive();
    let cases = [
        (today + chrono::Duration::days(20), "current"),
        (today - chrono::Duration::days(10), "d1_30"),
        (today - chrono::Duration::days(45), "d31_60"),
        (today - chrono::Duration::days(75), "d61_90"),
        (today - chrono::Duration::days(200), "d90_plus"),
    ];

    for (due, _) in cases {
        let (_, inv) = call(
            &app,
            send(
                "POST",
                "/api/e/books.invoices",
                &owner,
                json!({
                    "account_id": acct["id"],
                    "status": "sent",
                    "invoice_date": "2026-01-01",
                    "due_date": due.to_string(),
                }),
            ),
        )
        .await;
        call(
            &app,
            send(
                "POST",
                "/api/e/books.invoice_items",
                &owner,
                json!({
                    "invoice_id": inv["id"],
                    "description": "Service",
                    "quantity": "1",
                    "unit_price": "100.00"
                }),
            ),
        )
        .await;
    }

    let (status, report) = call(&app, get("/api/reports/ar_aging", &owner)).await;
    assert_eq!(status, StatusCode::OK, "{report}");

    let row = &report["rows"][0];
    assert_eq!(row["customer"], json!("Slow Payer Ltd"));
    // 100.00 in every bucket, and 500.00 owed in total.
    for bucket in ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] {
        assert_eq!(row[bucket], json!(10_000), "bucket `{bucket}` should hold one invoice");
    }
    assert_eq!(row["total"], json!(50_000));
    assert_eq!(row["invoices"], json!(5));
    assert_eq!(report["totals"]["total"], json!(50_000), "the totals row sums the money columns");
}

#[tokio::test]
async fn a_paid_or_draft_invoice_is_not_a_receivable() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "aging-status").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Payer" })),
    )
    .await;

    // A draft is not owed yet, and a paid invoice is not owed any more.
    for status in ["draft", "sent"] {
        let (_, inv) = call(
            &app,
            send(
                "POST",
                "/api/e/books.invoices",
                &owner,
                json!({
                    "account_id": acct["id"], "status": status,
                    "invoice_date": "2026-01-01", "due_date": "2026-02-01"
                }),
            ),
        )
        .await;
        call(
            &app,
            send(
                "POST",
                "/api/e/books.invoice_items",
                &owner,
                json!({ "invoice_id": inv["id"], "description": "x", "quantity": "1", "unit_price": "100.00" }),
            ),
        )
        .await;

        if status == "sent" {
            // Settle it in full, which should take it out of the report.
            call(
                &app,
                send(
                    "POST",
                    "/api/e/books.payments",
                    &owner,
                    json!({
                        "invoice_id": inv["id"], "account_id": acct["id"],
                        "amount": "100.00", "payment_date": "2026-01-15", "method": "cash"
                    }),
                ),
            )
            .await;
        }
    }

    let (_, report) = call(&app, get("/api/reports/ar_aging", &owner)).await;
    assert_eq!(
        report["rows"].as_array().map(|r| r.len()),
        Some(0),
        "neither a draft nor a settled invoice is a receivable"
    );
}

#[tokio::test]
async fn reports_are_gated_by_the_records_they_read() {
    let (app, state) = test_app().await;
    let _owner = new_org(&app, "report-rbac").await;
    let people = as_role(&state, &app, "report-rbac@example.test", "people").await;

    // The People role grants hr.* and recruit.* only, so no report qualifies.
    let (status, catalog) = call(&app, get("/api/reports", &people)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        catalog["data"].as_array().map(|a| a.len()),
        Some(0),
        "the catalogue must not advertise reports this role cannot run"
    );

    // And running one directly is refused, not merely hidden.
    let (status, _) = call(&app, get("/api/reports/ar_aging", &people)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_report_cannot_read_across_tenants() {
    let (app, _state) = test_app().await;
    let alice = new_org(&app, "report-alice").await;
    let bob = new_org(&app, "report-bob").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &alice, json!({ "name": "Alice Customer" })),
    )
    .await;
    let (_, inv) = call(
        &app,
        send(
            "POST",
            "/api/e/books.invoices",
            &alice,
            json!({
                "account_id": acct["id"], "status": "sent",
                "invoice_date": "2026-01-01", "due_date": "2020-01-01"
            }),
        ),
    )
    .await;
    call(
        &app,
        send(
            "POST",
            "/api/e/books.invoice_items",
            &alice,
            json!({ "invoice_id": inv["id"], "description": "x", "quantity": "1", "unit_price": "500.00" }),
        ),
    )
    .await;

    let (_, mine) = call(&app, get("/api/reports/ar_aging", &alice)).await;
    assert_eq!(mine["totals"]["total"], json!(50_000));

    let (_, theirs) = call(&app, get("/api/reports/ar_aging", &bob)).await;
    assert_eq!(
        theirs["rows"].as_array().map(|r| r.len()),
        Some(0),
        "a report is a query like any other and must be tenant-scoped"
    );
}

#[tokio::test]
async fn a_hand_built_role_is_enforced_exactly_as_written() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "role-author").await;

    // The catalogue is derived from the registry, so it must offer real grants.
    let (status, catalog) = call(&app, get("/api/settings/permissions", &owner)).await;
    assert_eq!(status, StatusCode::OK);
    let modules = catalog["modules"].as_array().unwrap();
    assert!(!modules.is_empty());
    for m in modules {
        for e in m["entities"].as_array().unwrap() {
            let key = e["key"].as_str().unwrap();
            assert_eq!(e["grants"]["view"], json!(format!("{key}.view")));
        }
    }

    let (status, roles) = call(
        &app,
        send(
            "POST",
            "/api/settings/roles",
            &owner,
            json!({
                "name": "Billing Clerk",
                "description": "Invoices only.",
                "permissions": ["books.invoices.*", "crm.accounts.view"]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{roles}");

    let clerk_role = roles["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["key"] == json!("billing_clerk"))
        .expect("the new role");
    assert_eq!(clerk_role["is_system"], json!(false));

    // Put the owner on it (dropping owner status, or the bypass hides the test).
    let clerk = as_role(&state, &app, "role-author@example.test", "billing_clerk").await;

    // Granted.
    let (status, _) = call(&app, get("/api/e/books.invoices", &clerk)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(&app, get("/api/e/crm.accounts", &clerk)).await;
    assert_eq!(status, StatusCode::OK);

    // Not granted: reading a different module, and writing where only view was given.
    let (status, _) = call(&app, get("/api/e/crm.deals", &clerk)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &clerk, json!({ "name": "Nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "view does not imply create");

    // Navigation and reports follow the same grants.
    let (_, meta) = call(&app, get("/api/meta", &clerk)).await;
    let modules: Vec<String> = meta["modules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["key"].as_str().unwrap().to_string())
        .collect();
    assert!(modules.contains(&"books".to_string()));
    assert!(!modules.contains(&"crm".to_string()) || modules.contains(&"crm".to_string()));
    assert!(!modules.contains(&"hr".to_string()), "unreached modules stay hidden: {modules:?}");
}

#[tokio::test]
async fn a_role_cannot_grant_something_that_does_not_exist() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "role-validate").await;

    for permissions in [
        json!(["books.invoices.view", "nonsense.thing.view"]),
        json!(["not_a_module.*"]),
    ] {
        let (status, body) = call(
            &app,
            send(
                "POST",
                "/api/settings/roles",
                &owner,
                json!({ "name": "Bogus", "permissions": permissions }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }

    // A role that grants nothing is a role nobody can use.
    let (status, _) = call(
        &app,
        send("POST", "/api/settings/roles", &owner, json!({ "name": "Empty", "permissions": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn built_in_roles_are_immutable_and_roles_in_use_are_undeletable() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "role-guards").await;

    let (_, roles) = call(&app, get("/api/settings/roles", &owner)).await;
    let admin = roles["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["key"] == json!("admin"))
        .unwrap()
        .clone();
    let admin_id = admin["id"].as_str().unwrap();

    // Editing a built-in role would change what everyone holding it can do.
    let (status, _) = call(
        &app,
        send(
            "PATCH",
            &format!("/api/settings/roles/{admin_id}"),
            &owner,
            json!({ "name": "Hijacked", "permissions": ["*"] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = call(
        &app,
        send("DELETE", &format!("/api/settings/roles/{admin_id}"), &owner, Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // A custom role with nobody on it can go.
    let (_, roles) = call(
        &app,
        send(
            "POST",
            "/api/settings/roles",
            &owner,
            json!({ "name": "Temp", "permissions": ["desk.tickets.view"] }),
        ),
    )
    .await;
    let temp_id = roles["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["key"] == json!("temp"))
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let (status, _) = call(
        &app,
        send("DELETE", &format!("/api/settings/roles/{temp_id}"), &owner, Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn only_an_owner_can_author_roles() {
    let (app, state) = test_app().await;
    let _owner = new_org(&app, "role-rbac").await;
    let admin = as_role(&state, &app, "role-rbac@example.test", "admin").await;

    let (status, _) = call(&app, get("/api/settings/permissions", &admin)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = call(
        &app,
        send(
            "POST",
            "/api/settings/roles",
            &admin,
            json!({ "name": "Sneaky", "permissions": ["*"] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "a non-owner admin must not mint roles");
}

#[tokio::test]
async fn search_follows_records_as_they_are_written_and_deleted() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "search").await;

    let (_, acct) = call(
        &app,
        send(
            "POST",
            "/api/e/crm.accounts",
            &owner,
            json!({ "name": "Zeppelin Freight", "industry": "Logistics" }),
        ),
    )
    .await;
    let id = acct["id"].as_str().unwrap().to_string();

    // A new record is findable without a reindex.
    let (status, hits) = call(&app, get("/api/search?q=zeppelin", &owner)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(hits["groups"][0]["items"][0]["title"], json!("Zeppelin Freight"));

    // Renaming it moves the index with it.
    call(
        &app,
        send("PATCH", &format!("/api/e/crm.accounts/{id}"), &owner, json!({ "name": "Hindenburg Freight" })),
    )
    .await;
    let (_, hits) = call(&app, get("/api/search?q=zeppelin", &owner)).await;
    assert_eq!(
        hits["groups"].as_array().map(|g| g.len()),
        Some(0),
        "the old name must stop matching"
    );
    let (_, hits) = call(&app, get("/api/search?q=hindenburg", &owner)).await;
    assert_eq!(hits["groups"][0]["items"][0]["title"], json!("Hindenburg Freight"));

    // Deleting it takes it out of the index.
    call(
        &app,
        send("DELETE", &format!("/api/e/crm.accounts/{id}"), &owner, Value::Null),
    )
    .await;
    let (_, hits) = call(&app, get("/api/search?q=hindenburg", &owner)).await;
    assert_eq!(
        hits["groups"].as_array().map(|g| g.len()),
        Some(0),
        "a deleted record must stop being findable"
    );
}

#[tokio::test]
async fn search_input_is_never_parsed_as_query_syntax() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "search-syntax").await;

    call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Blue-Harbor O'Neill" })),
    )
    .await;

    // Each of these is an FTS5 syntax error if passed through unquoted.
    for term in ["blue-harbor", "o'neill", "NEAR(a b)", "foo*", "\"quoted\"", "a OR b", "^caret"] {
        let (status, body) = call(
            &app,
            get(&format!("/api/search?q={}", urlencode(term)), &owner),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "`{term}` should search, not error: {body}");
    }

    // And the hyphenated one actually finds the record.
    let (_, hits) = call(&app, get("/api/search?q=blue-harbor", &owner)).await;
    assert_eq!(hits["groups"][0]["items"][0]["title"], json!("Blue-Harbor O'Neill"));
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

#[tokio::test]
async fn the_search_index_is_tenant_scoped_like_every_other_query() {
    let (app, _state) = test_app().await;
    let alice = new_org(&app, "search-alice").await;
    let bob = new_org(&app, "search-bob").await;

    call(
        &app,
        send("POST", "/api/e/crm.accounts", &alice, json!({ "name": "Alice Secret Holdings" })),
    )
    .await;

    let (_, mine) = call(&app, get("/api/search?q=secret", &alice)).await;
    assert_eq!(mine["groups"][0]["items"][0]["title"], json!("Alice Secret Holdings"));

    let (_, theirs) = call(&app, get("/api/search?q=secret", &bob)).await;
    assert_eq!(
        theirs["groups"].as_array().map(|g| g.len()),
        Some(0),
        "an index is a second copy of the data and a second place isolation can leak"
    );
}

#[tokio::test]
async fn search_results_stay_inside_the_callers_permissions() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "search-rbac").await;

    call(
        &app,
        send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Findable Deal" })),
    )
    .await;
    call(
        &app,
        send("POST", "/api/e/hr.employees", &owner, json!({ "full_name": "Findable Person", "designation": "Staff" })),
    )
    .await;

    let people = as_role(&state, &app, "search-rbac@example.test", "people").await;
    let (_, hits) = call(&app, get("/api/search?q=findable", &people)).await;

    let entities: Vec<&str> = hits["groups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["entity"].as_str().unwrap())
        .collect();
    assert!(entities.contains(&"hr.employees"), "HR is granted: {entities:?}");
    assert!(!entities.contains(&"crm.deals"), "CRM is not: {entities:?}");
}

/// Create an approval rule and return the expense id awaiting a decision.
async fn expense_awaiting_approval(app: &Router, state: &AppState, owner: &str, who: &str) -> String {
    let finance = role_id(state, &format!("{who}@example.test"), "finance").await;

    let (status, rules) = call(
        app,
        send(
            "POST",
            "/api/settings/approval-rules",
            owner,
            json!({
                "name": "Large expense sign-off",
                "entity": "books.expenses",
                "conditions": {"match":"all","rules":[
                    {"field":"amount","op":"gte","value":"1000"},
                    {"field":"status","op":"eq","value":"submitted"}
                ]},
                "approver_role_id": finance,
                "decision_field": "status",
                "approved_value": "approved",
                "rejected_value": "rejected"
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rules}");

    let (_, big) = call(
        app,
        send(
            "POST",
            "/api/e/books.expenses",
            owner,
            json!({
                "description": "Conference sponsorship", "category": "marketing",
                "amount": "7500.00", "expense_date": "2026-09-02", "status": "submitted"
            }),
        ),
    )
    .await;
    big["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn an_approval_gates_a_record_until_someone_decides() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "approve").await;
    let big_id = expense_awaiting_approval(&app, &state, &owner, "approve").await;

    // Under the threshold, nothing is raised.
    call(
        &app,
        send(
            "POST",
            "/api/e/books.expenses",
            &owner,
            json!({
                "description": "Taxi", "category": "travel",
                "amount": "45.00", "expense_date": "2026-09-02", "status": "submitted"
            }),
        ),
    )
    .await;

    let (_, queue) = call(&app, get("/api/approvals", &owner)).await;
    assert_eq!(
        queue["data"].as_array().map(|a| a.len()),
        Some(1),
        "only the large claim should need a decision"
    );
    assert_eq!(queue["data"][0]["record_title"], json!("Conference sponsorship"));

    // Re-saving the record must not stack up a second request.
    call(
        &app,
        send("PATCH", &format!("/api/e/books.expenses/{big_id}"), &owner, json!({ "notes": "receipt" })),
    )
    .await;
    let (_, queue) = call(&app, get("/api/approvals", &owner)).await;
    assert_eq!(queue["data"].as_array().map(|a| a.len()), Some(1));

    // Approving writes the decision onto the record.
    let request_id = queue["data"][0]["id"].as_str().unwrap().to_string();
    let (status, decision) = call(
        &app,
        send(
            "POST",
            &format!("/api/approvals/{request_id}/decide"),
            &owner,
            json!({ "decision": "approve", "comment": "Within budget." }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decision}");

    let (_, expense) = call(&app, get(&format!("/api/e/books.expenses/{big_id}"), &owner)).await;
    assert_eq!(expense["status"], json!("approved"));

    // A decided request cannot be decided again.
    let (status, _) = call(
        &app,
        send(
            "POST",
            &format!("/api/approvals/{request_id}/decide"),
            &owner,
            json!({ "decision": "reject" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Deciding is on the record's timeline, with the comment.
    let (_, trail) = call(&app, get(&format!("/api/e/books.expenses/{big_id}/audit"), &owner)).await;
    let summary = trail["data"][0]["summary"].as_str().unwrap_or_default();
    assert!(summary.contains("Approved"), "{summary}");
    assert!(summary.contains("Within budget"), "the comment should be recorded: {summary}");
}

#[tokio::test]
async fn an_approval_is_only_decidable_by_its_approver() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "approve-rbac").await;
    let _big = expense_awaiting_approval(&app, &state, &owner, "approve-rbac").await;

    let (_, queue) = call(&app, get("/api/approvals", &owner)).await;
    let request_id = queue["data"][0]["id"].as_str().unwrap().to_string();

    // Support holds neither the Finance role nor ownership.
    let support = as_role(&state, &app, "approve-rbac@example.test", "support").await;

    let (_, their_queue) = call(&app, get("/api/approvals", &support)).await;
    assert_eq!(
        their_queue["data"].as_array().map(|a| a.len()),
        Some(0),
        "a queue must only show what you can act on"
    );

    let (status, _) = call(
        &app,
        send(
            "POST",
            &format!("/api/approvals/{request_id}/decide"),
            &support,
            json!({ "decision": "approve" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "and refuse the ones you cannot");
}

#[tokio::test]
async fn an_approval_rule_cannot_write_a_value_its_field_rejects() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "approve-validate").await;

    // `banana` is not one of the status options, so approving would fail at the
    // moment somebody clicked it. Refuse the rule instead.
    let (status, body) = call(
        &app,
        send(
            "POST",
            "/api/settings/approval-rules",
            &owner,
            json!({
                "name": "Bad", "entity": "books.expenses", "conditions": {"rules":[]},
                "decision_field": "status", "approved_value": "banana", "rejected_value": "rejected"
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // A server-computed field is not somewhere a decision can land.
    let (status, _) = call(
        &app,
        send(
            "POST",
            "/api/settings/approval-rules",
            &owner,
            json!({
                "name": "Bad", "entity": "books.invoices", "conditions": {"rules":[]},
                "decision_field": "balance_due", "approved_value": "1", "rejected_value": "2"
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Approving and rejecting must be distinguishable.
    let (status, _) = call(
        &app,
        send(
            "POST",
            "/api/settings/approval-rules",
            &owner,
            json!({
                "name": "Same", "entity": "books.expenses", "conditions": {"rules":[]},
                "decision_field": "status", "approved_value": "approved", "rejected_value": "approved"
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn a_webhook_queues_a_signed_delivery_for_the_events_it_subscribes_to() {
    let (app, state) = test_app().await;
    let owner = new_org(&app, "webhook").await;

    let (status, hook) = call(
        &app,
        send(
            "POST",
            "/api/settings/webhooks",
            &owner,
            json!({
                "name": "Deal notifier",
                "url": "https://example.com/hook",
                "events": ["crm.deals.create"]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{hook}");
    let secret = hook["secret"].as_str().expect("the secret is returned once").to_string();
    assert_eq!(secret.len(), 64);

    // A subscribed event queues a delivery...
    call(&app, send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Watched deal" }))).await;
    // ...an unsubscribed one does not.
    call(&app, send("POST", "/api/e/crm.leads", &owner, json!({ "last_name": "Unwatched", "full_name": "Unwatched", "company": "X" }))).await;

    let hook_id = hook["id"].as_str().unwrap();
    let (_, deliveries) = call(
        &app,
        get(&format!("/api/settings/webhooks/{hook_id}/deliveries"), &owner),
    )
    .await;
    let rows = deliveries["data"].as_array().unwrap();
    assert_eq!(rows.len(), 1, "exactly the subscribed event should be queued");
    assert_eq!(rows[0]["event"], json!("crm.deals.create"));

    let queued: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE kind = 'webhook_delivery'")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(queued, 1, "delivery rides the job queue, not the request");

    // The secret is never handed back on a read.
    let (_, listed) = call(&app, get("/api/settings/webhooks", &owner)).await;
    assert!(
        listed["data"][0].get("secret").is_none(),
        "a stored webhook must not expose its secret"
    );
}

#[tokio::test]
async fn a_webhook_cannot_be_pointed_at_the_servers_own_network() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "webhook-ssrf").await;

    // The cloud metadata endpoint is the case this guard exists for.
    for url in [
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost:8787/api/auth/me",
        "http://127.0.0.1/",
        "http://10.1.2.3/",
        "file:///etc/passwd",
    ] {
        let (status, body) = call(
            &app,
            send(
                "POST",
                "/api/settings/webhooks",
                &owner,
                json!({ "name": "Probe", "url": url, "events": ["crm.deals.create"] }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{url} should be refused: {body}");
    }

    // An event naming nothing would never fire, so it is refused too.
    let (status, _) = call(
        &app,
        send(
            "POST",
            "/api/settings/webhooks",
            &owner,
            json!({ "name": "Bad event", "url": "https://example.com/h", "events": ["nope.thing.create"] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn a_money_threshold_means_what_the_person_typed() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "scale").await;

    // "1000" in the form means a thousand pounds. Records store money in minor
    // units, so a rule comparing the typed decimal against the stored integer
    // straight would fire at ten pounds — a hundredfold error, silently.
    let (status, rule) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Flag big deals",
                "entity": "crm.deals",
                "trigger": "on_create",
                "conditions": {"match":"all","rules":[{"field":"amount","op":"gte","value":"1000"}]},
                "actions": [{"type":"set_field","field":"next_step","value":"Review with finance"}]
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rule}");

    // Comfortably under the threshold, and above it only if the scale is wrong.
    let (_, small) = call(
        &app,
        send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Small", "amount": "50.00" })),
    )
    .await;
    assert_eq!(
        small["next_step"], Value::Null,
        "a £50 deal must not trip a £1000 threshold"
    );

    let (_, big) = call(
        &app,
        send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Big", "amount": "2500.00" })),
    )
    .await;
    assert_eq!(big["next_step"], json!("Review with finance"));

    // Exactly on the boundary counts, since the operator is "at least".
    let (_, exact) = call(
        &app,
        send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Exact", "amount": "1000.00" })),
    )
    .await;
    assert_eq!(exact["next_step"], json!("Review with finance"));

    // The same input box feeds set_field, which was already scaled — the two
    // must agree about what "1000" means.
    let (_, action_rule) = call(
        &app,
        send(
            "POST",
            "/api/settings/automations",
            &owner,
            json!({
                "name": "Set an amount",
                "entity": "crm.deals",
                "trigger": "on_update",
                "conditions": {"match":"all","rules":[{"field":"next_step","op":"eq","value":"bump"}]},
                "actions": [{"type":"set_field","field":"amount","value":"1000"}]
            }),
        ),
    )
    .await;
    assert_eq!(action_rule["id"].is_string(), true);

    let (_, target) = call(
        &app,
        send("POST", "/api/e/crm.deals", &owner, json!({ "name": "Target", "amount": "1.00" })),
    )
    .await;
    let id = target["id"].as_str().unwrap();
    let (_, bumped) = call(
        &app,
        send("PATCH", &format!("/api/e/crm.deals/{id}"), &owner, json!({ "next_step": "bump" })),
    )
    .await;
    assert_eq!(bumped["amount"], json!(100_000), "an action writing 1000 means £1000 too");
}

#[tokio::test]
async fn deleting_a_payment_puts_the_money_back_on_the_invoice() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "unpay").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Payer" })),
    )
    .await;
    let (_, inv) = call(
        &app,
        send(
            "POST",
            "/api/e/books.invoices",
            &owner,
            json!({
                "account_id": acct["id"], "status": "sent",
                "invoice_date": "2026-01-01", "due_date": "2099-01-01"
            }),
        ),
    )
    .await;
    let inv_id = inv["id"].as_str().unwrap().to_string();
    call(
        &app,
        send(
            "POST",
            "/api/e/books.invoice_items",
            &owner,
            json!({ "invoice_id": inv_id, "description": "Work", "quantity": "1", "unit_price": "324.00" }),
        ),
    )
    .await;

    let (_, payment) = call(
        &app,
        send(
            "POST",
            "/api/e/books.payments",
            &owner,
            json!({
                "invoice_id": inv_id, "account_id": acct["id"],
                "amount": "324.00", "payment_date": "2026-01-05", "method": "cash"
            }),
        ),
    )
    .await;
    let (_, paid) = call(&app, get(&format!("/api/e/books.invoices/{inv_id}"), &owner)).await;
    assert_eq!(paid["status"], json!("paid"));
    assert_eq!(paid["balance_due"], json!(0));

    // Reversing the payment must put the debt back. Leaving the invoice on
    // "paid" would write off real money and hide it from the ageing report.
    let payment_id = payment["id"].as_str().unwrap();
    let (status, _) = call(
        &app,
        send("DELETE", &format!("/api/e/books.payments/{payment_id}"), &owner, Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, after) = call(&app, get(&format!("/api/e/books.invoices/{inv_id}"), &owner)).await;
    assert_eq!(after["amount_paid"], json!(0), "the payment is gone");
    assert_eq!(after["balance_due"], json!(32_400), "so the balance is owed again");
    assert_ne!(after["status"], json!("paid"));

    // And it is a receivable again.
    let (_, aging) = call(&app, get("/api/reports/ar_aging", &owner)).await;
    assert_eq!(aging["totals"]["total"], json!(32_400));
}

#[tokio::test]
async fn deleting_a_stock_move_corrects_the_level() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "unstock").await;

    let (_, item) = call(
        &app,
        send("POST", "/api/e/inventory.items", &owner, json!({ "name": "Widget", "sku": "W-1" })),
    )
    .await;
    let item_id = item["id"].as_str().unwrap().to_string();

    let (_, move_in) = call(
        &app,
        send(
            "POST",
            "/api/e/inventory.stock_moves",
            &owner,
            json!({ "item_id": item_id, "move_type": "purchase", "quantity": "100", "moved_on": "2026-01-01" }),
        ),
    )
    .await;
    let (_, item) = call(&app, get(&format!("/api/e/inventory.items/{item_id}"), &owner)).await;
    assert_eq!(item["stock_on_hand"], json!(100_000));

    let move_id = move_in["id"].as_str().unwrap();
    call(
        &app,
        send("DELETE", &format!("/api/e/inventory.stock_moves/{move_id}"), &owner, Value::Null),
    )
    .await;

    let (_, item) = call(&app, get(&format!("/api/e/inventory.items/{item_id}"), &owner)).await;
    assert_eq!(
        item["stock_on_hand"], json!(0),
        "the level must stay explainable by the movements behind it"
    );
}

#[tokio::test]
async fn reports_do_not_join_across_tenants() {
    let (app, _state) = test_app().await;
    let alice = new_org(&app, "join-alice").await;
    let bob = new_org(&app, "join-bob").await;

    // Alice's account, whose name must never surface in Bob's reports.
    let (_, secret) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &alice, json!({ "name": "ALICE SECRET CUSTOMER" })),
    )
    .await;
    let secret_id = secret["id"].as_str().unwrap().to_string();

    // Bob points one of his own invoices at it. The engine scopes reads by
    // org_id, so Bob cannot *read* that account — but a report joining
    // `accounts` without an org predicate would still pull its name through.
    let (status, inv) = call(
        &app,
        send(
            "POST",
            "/api/e/books.invoices",
            &bob,
            json!({
                "account_id": secret_id, "status": "sent",
                "invoice_date": "2026-01-01", "due_date": "2020-01-01"
            }),
        ),
    )
    .await;

    if status == StatusCode::OK {
        call(
            &app,
            send(
                "POST",
                "/api/e/books.invoice_items",
                &bob,
                json!({ "invoice_id": inv["id"], "description": "x", "quantity": "1", "unit_price": "500.00" }),
            ),
        )
        .await;

        for report in ["ar_aging", "top_customers"] {
            let (_, out) = call(&app, get(&format!("/api/reports/{report}"), &bob)).await;
            let body = out.to_string();
            assert!(
                !body.contains("ALICE SECRET CUSTOMER"),
                "{report} leaked another tenant's account name: {body}"
            );
        }
    }

    // Alice's own report is unaffected.
    let (_, mine) = call(&app, get("/api/reports/ar_aging", &alice)).await;
    assert_eq!(mine["rows"].as_array().map(|r| r.len()), Some(0));
}

#[tokio::test]
async fn a_refresh_token_cannot_be_spent_twice() {
    let (app, _state) = test_app().await;

    let (_, session) = call(
        &app,
        anon(
            "POST",
            "/api/auth/register",
            json!({
                "name": "Rotator", "email": "rotate@example.test",
                "password": "a-long-enough-password", "organization": "Rotate Co"
            }),
        ),
    )
    .await;
    let refresh = session["refresh_token"].as_str().unwrap().to_string();

    let (first, _) = call(
        &app,
        anon("POST", "/api/auth/refresh", json!({ "refresh_token": refresh })),
    )
    .await;
    assert_eq!(first, StatusCode::OK);

    // The claim is one statement guarded on `revoked_at IS NULL`, so replaying
    // the same token cannot mint a second session.
    let (second, _) = call(
        &app,
        anon("POST", "/api/auth/refresh", json!({ "refresh_token": refresh })),
    )
    .await;
    assert_eq!(second, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn one_order_can_only_become_one_invoice() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "one-invoice").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &owner, json!({ "name": "Buyer" })),
    )
    .await;
    let (_, order) = call(
        &app,
        send(
            "POST",
            "/api/e/sales.orders",
            &owner,
            json!({ "subject": "Kit", "account_id": acct["id"], "order_date": "2026-01-01" }),
        ),
    )
    .await;
    let order_id = order["id"].as_str().unwrap().to_string();
    call(
        &app,
        send(
            "POST",
            "/api/e/sales.order_items",
            &owner,
            json!({ "sales_order_id": order_id, "description": "Kit", "quantity": "1", "unit_price": "100.00" }),
        ),
    )
    .await;

    let (first, _) = call(
        &app,
        send("POST", &format!("/api/actions/sales.orders/{order_id}/convert"), &owner, json!({})),
    )
    .await;
    assert_eq!(first, StatusCode::OK);

    let (second, _) = call(
        &app,
        send("POST", &format!("/api/actions/sales.orders/{order_id}/convert"), &owner, json!({})),
    )
    .await;
    assert_eq!(second, StatusCode::CONFLICT, "billing a customer twice is the failure to avoid");

    let (_, invoices) = call(&app, get("/api/e/books.invoices", &owner)).await;
    assert_eq!(invoices["total"], json!(1));
}

#[tokio::test]
async fn a_lead_converts_once_even_if_asked_twice() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "convert-once").await;

    let (_, lead) = call(
        &app,
        send(
            "POST",
            "/api/e/crm.leads",
            &owner,
            json!({ "last_name": "Fisher", "full_name": "Kim Fisher", "company": "Fisher Ltd" }),
        ),
    )
    .await;
    let lead_id = lead["id"].as_str().unwrap().to_string();

    let (first, _) = call(
        &app,
        send(&"POST", &format!("/api/actions/crm.leads/{lead_id}/convert"), &owner, json!({ "create_deal": true })),
    )
    .await;
    assert_eq!(first, StatusCode::OK);

    let (second, _) = call(
        &app,
        send("POST", &format!("/api/actions/crm.leads/{lead_id}/convert"), &owner, json!({ "create_deal": true })),
    )
    .await;
    assert_eq!(second, StatusCode::CONFLICT);

    // And exactly one customer exists, not two.
    let (_, accounts) = call(&app, get("/api/e/crm.accounts", &owner)).await;
    assert_eq!(accounts["total"], json!(1), "a second convert must not duplicate the customer");
}

#[tokio::test]
async fn a_bill_reports_what_is_actually_outstanding() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "bills").await;

    let (_, vendor) = call(
        &app,
        send("POST", "/api/e/inventory.vendors", &owner, json!({ "name": "Supplier" })),
    )
    .await;

    // `balance_due` is readonly, so nothing the client sends reaches it — the
    // server has to compute it, or every unpaid bill reads as zero owed.
    let (_, bill) = call(
        &app,
        send(
            "POST",
            "/api/e/books.bills",
            &owner,
            json!({
                "vendor_id": vendor["id"], "bill_date": "2026-01-01", "due_date": "2099-01-01",
                "subtotal": "1000.00", "total": "1000.00", "amount_paid": "0"
            }),
        ),
    )
    .await;
    let bill_id = bill["id"].as_str().unwrap().to_string();
    assert_eq!(bill["balance_due"], json!(100_000), "the full amount is owed");
    assert_eq!(bill["status"], json!("open"));

    let (_, part) = call(
        &app,
        send("PATCH", &format!("/api/e/books.bills/{bill_id}"), &owner, json!({ "amount_paid": "400.00" })),
    )
    .await;
    assert_eq!(part["balance_due"], json!(60_000));
    assert_eq!(part["status"], json!("partial"));

    let (_, settled) = call(
        &app,
        send("PATCH", &format!("/api/e/books.bills/{bill_id}"), &owner, json!({ "amount_paid": "1000.00" })),
    )
    .await;
    assert_eq!(settled["balance_due"], json!(0));
    assert_eq!(settled["status"], json!("paid"));
}

#[tokio::test]
async fn an_absurd_page_number_does_not_take_the_list_down() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "paging").await;

    // Multiplying an unbounded page by per_page overflows i64 — a panic in a
    // debug build, which is a request away from taking the API with it.
    for q in ["page=9223372036854775807", "page=999999999999&per_page=200", "page=-1"] {
        let (status, _) = call(&app, get(&format!("/api/e/crm.accounts?{q}"), &owner)).await;
        assert_eq!(status, StatusCode::OK, "{q} should be servable");
    }
}

#[tokio::test]
async fn hostile_query_parameters_cannot_reach_sql() {
    let (app, _state) = test_app().await;
    let token = new_org(&app, "inject").await;

    call(
        &app,
        send("POST", "/api/e/crm.accounts", &token, json!({ "name": "Real Record" })),
    )
    .await;

    // Unknown columns, quote-breaking names and a tautology are all dropped
    // rather than interpolated - the row count must not change.
    for hostile in [
        "/api/e/crm.accounts?name%22%20OR%201=1--=x",
        "/api/e/crm.accounts?bogus_column=1",
        "/api/e/crm.accounts?sort=%3B%20DROP%20TABLE%20accounts",
        "/api/e/crm.accounts?account_type__in=",
    ] {
        let (status, body) = call(&app, get(hostile, &token)).await;
        assert_eq!(status, StatusCode::OK, "{hostile} -> {body}");
    }

    let (_, list) = call(&app, get("/api/e/crm.accounts", &token)).await;
    assert_eq!(list["total"], json!(1), "the accounts table should still be intact");
}

#[tokio::test]
async fn a_currency_must_be_one_of_the_offered_codes() {
    // Currency was free text, so "Euro", "euros" and "$" all stored happily and
    // every amount on the document was then formatted against a code that means
    // nothing. The engine validates a Select against its own options, so the
    // typo has to be refused at write time rather than discovered on an invoice.
    let (app, _state) = test_app().await;
    let token = new_org(&app, "money").await;

    let (_, acct) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &token, json!({ "name": "Payer Ltd" })),
    )
    .await;

    let base = |currency: &str| {
        json!({
            "account_id": acct["id"],
            "invoice_date": "2026-01-05",
            "due_date": "2099-01-01",
            "currency": currency,
        })
    };

    for bad in ["Euro", "euros", "$", "usd "] {
        let (status, body) = call(
            &app,
            send("POST", "/api/e/books.invoices", &token, base(bad)),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "`{bad}` should not be accepted as a currency, got {body}"
        );
    }

    let (status, body) = call(
        &app,
        send("POST", "/api/e/books.invoices", &token, base("EUR")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "a listed code must still work: {body}");
    assert_eq!(body["currency"], json!("EUR"));

    // Optional: blank still means "whatever the organisation uses".
    let (status, body) = call(
        &app,
        send(
            "POST",
            "/api/e/books.invoices",
            &token,
            json!({
                "account_id": acct["id"],
                "invoice_date": "2026-01-05",
                "due_date": "2099-01-01",
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "currency must stay optional: {body}");
}

#[tokio::test]
async fn clocking_out_derives_the_minutes_worked() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "clocking").await;

    let (_, emp) = call(
        &app,
        send("POST", "/api/e/hr.employees", &owner, json!({ "full_name": "Dana Reyes", "designation": "Operations lead" })),
    )
    .await;
    let emp_id = emp["id"].as_str().unwrap().to_string();

    // A plain 9-to-5.
    let (_, day) = call(
        &app,
        send("POST", "/api/e/hr.attendance", &owner, json!({
            "employee_id": emp_id,
            "work_date": "2026-03-02",
            "clock_in": "2026-03-02T09:00:00Z",
            "clock_out": "2026-03-02T17:30:00Z"
        })),
    )
    .await;
    let day_id = day["id"].as_str().unwrap().to_string();
    let (_, day) = call(&app, get(&format!("/api/e/hr.attendance/{day_id}"), &owner)).await;
    assert_eq!(day["worked_minutes"], json!(510), "09:00 to 17:30 is eight and a half hours");

    // Still clocked in: nothing to total yet, and certainly not a negative.
    let (_, open) = call(
        &app,
        send("POST", "/api/e/hr.attendance", &owner, json!({
            "employee_id": emp_id,
            "work_date": "2026-03-03",
            "clock_in": "2026-03-03T09:00:00Z"
        })),
    )
    .await;
    let open_id = open["id"].as_str().unwrap().to_string();
    let (_, open) = call(&app, get(&format!("/api/e/hr.attendance/{open_id}"), &owner)).await;
    assert_eq!(open["worked_minutes"], json!(0), "an open shift has no total");

    // A night shift ends on the following morning, which is not negative time.
    let (_, night) = call(
        &app,
        send("POST", "/api/e/hr.attendance", &owner, json!({
            "employee_id": emp_id,
            "work_date": "2026-03-04",
            "clock_in": "2026-03-04T22:00:00Z",
            "clock_out": "2026-03-05T06:00:00Z"
        })),
    )
    .await;
    let night_id = night["id"].as_str().unwrap().to_string();
    let (_, night) = call(&app, get(&format!("/api/e/hr.attendance/{night_id}"), &owner)).await;
    assert_eq!(night["worked_minutes"], json!(480), "22:00 to 06:00 is eight hours, not minus sixteen");

    // Correcting the clock-out has to move the total with it.
    call(
        &app,
        send("PATCH", &format!("/api/e/hr.attendance/{day_id}"), &owner, json!({
            "clock_out": "2026-03-02T16:00:00Z"
        })),
    )
    .await;
    let (_, fixed) = call(&app, get(&format!("/api/e/hr.attendance/{day_id}"), &owner)).await;
    assert_eq!(fixed["worked_minutes"], json!(420), "a corrected stamp cannot leave a stale total");
}

#[tokio::test]
async fn one_attendance_row_per_person_per_day() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "oneperday").await;

    let (_, emp) = call(
        &app,
        send("POST", "/api/e/hr.employees", &owner, json!({ "full_name": "Marcus Webb", "designation": "Technician" })),
    )
    .await;
    let emp_id = emp["id"].as_str().unwrap().to_string();

    let body = json!({ "employee_id": emp_id, "work_date": "2026-03-02", "clock_in": "2026-03-02T09:00:00Z" });
    let (first, _) = call(&app, send("POST", "/api/e/hr.attendance", &owner, body.clone())).await;
    assert!(first.is_success(), "the first clock-in of the day is fine");

    let (second, _) = call(&app, send("POST", "/api/e/hr.attendance", &owner, body)).await;
    assert!(
        !second.is_success(),
        "a second row for the same day would count that day twice in every total downstream"
    );
}

#[tokio::test]
async fn a_shift_is_what_makes_a_clock_in_late() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "lateness").await;

    let (_, emp) = call(
        &app,
        send("POST", "/api/e/hr.employees", &owner, json!({ "full_name": "Priya Nair", "designation": "Shift supervisor" })),
    )
    .await;
    let emp_id = emp["id"].as_str().unwrap().to_string();

    let (_, shift) = call(
        &app,
        send("POST", "/api/e/hr.shifts", &owner, json!({
            "employee_id": emp_id,
            "shift_date": "2026-03-02",
            "starts_at": "2026-03-02T09:00:00Z",
            "ends_at": "2026-03-02T17:00:00Z"
        })),
    )
    .await;
    let shift_id = shift["id"].as_str().unwrap().to_string();

    // Four minutes over is inside the grace period.
    let (_, ok_day) = call(
        &app,
        send("POST", "/api/e/hr.attendance", &owner, json!({
            "employee_id": emp_id, "shift_id": shift_id, "work_date": "2026-03-02",
            "clock_in": "2026-03-02T09:04:00Z"
        })),
    )
    .await;
    let ok_id = ok_day["id"].as_str().unwrap().to_string();
    let (_, ok_day) = call(&app, get(&format!("/api/e/hr.attendance/{ok_id}"), &owner)).await;
    assert_eq!(ok_day["status"], json!("present"), "a few minutes is not lateness");

    // Twenty is not.
    call(
        &app,
        send("PATCH", &format!("/api/e/hr.attendance/{ok_id}"), &owner, json!({
            "clock_in": "2026-03-02T09:20:00Z"
        })),
    )
    .await;
    let (_, late) = call(&app, get(&format!("/api/e/hr.attendance/{ok_id}"), &owner)).await;
    assert_eq!(late["status"], json!("late"), "twenty minutes past the shift start is late");

    // A day somebody already judged is not re-judged by a clock stamp.
    let (_, leave) = call(
        &app,
        send("POST", "/api/e/hr.attendance", &owner, json!({
            "employee_id": emp_id, "shift_id": shift_id, "work_date": "2026-03-03",
            "clock_in": "2026-03-03T11:00:00Z", "status": "on_leave"
        })),
    )
    .await;
    let leave_id = leave["id"].as_str().unwrap();
    let (_, leave) = call(&app, get(&format!("/api/e/hr.attendance/{leave_id}"), &owner)).await;
    assert_eq!(leave["status"], json!("on_leave"), "a stamp cannot overrule a decision about the day");
}

#[tokio::test]
async fn a_payslip_is_built_from_what_was_already_recorded() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "payroll").await;

    let (_, emp) = call(
        &app,
        send("POST", "/api/e/hr.employees", &owner, json!({ "full_name": "Tom Okafor", "designation": "Fitter" })),
    )
    .await;
    let emp_id = emp["id"].as_str().unwrap().to_string();

    // Two days inside the period and one outside it.
    for (date, out) in [
        ("2026-03-02", "2026-03-02T17:00:00Z"),
        ("2026-03-03", "2026-03-03T17:00:00Z"),
        ("2026-04-01", "2026-04-01T17:00:00Z"),
    ] {
        call(
            &app,
            send("POST", "/api/e/hr.attendance", &owner, json!({
                "employee_id": emp_id, "work_date": date,
                "clock_in": format!("{date}T09:00:00Z"), "clock_out": out
            })),
        )
        .await;
    }

    let (_, run) = call(
        &app,
        send("POST", "/api/e/hr.pay_runs", &owner, json!({
            "reference": "March 2026", "period_start": "2026-03-01", "period_end": "2026-03-31"
        })),
    )
    .await;
    let run_id = run["id"].as_str().unwrap().to_string();

    let (_, slip) = call(
        &app,
        send("POST", "/api/e/hr.payslips", &owner, json!({
            "pay_run_id": run_id, "employee_id": emp_id, "gross": "3200", "deductions": "450"
        })),
    )
    .await;
    let slip_id = slip["id"].as_str().unwrap().to_string();

    let (_, slip) = call(&app, get(&format!("/api/e/hr.payslips/{slip_id}"), &owner)).await;
    assert_eq!(slip["net"], json!(275_000), "net is gross less deductions, in minor units");
    assert_eq!(
        slip["minutes_worked"], json!(960),
        "two eight-hour days inside the period, and not the April one outside it"
    );
    assert_eq!(slip["slip_for"], json!("Tom Okafor — March 2026"), "a slip names its person and run");

    let (_, run) = call(&app, get(&format!("/api/e/hr.pay_runs/{run_id}"), &owner)).await;
    assert_eq!(run["total_gross"], json!(320_000));
    assert_eq!(run["total_net"], json!(275_000));

    // Removing the slip has to take it back out of the run.
    call(&app, send("DELETE", &format!("/api/e/hr.payslips/{slip_id}"), &owner, Value::Null)).await;
    let (_, run) = call(&app, get(&format!("/api/e/hr.pay_runs/{run_id}"), &owner)).await;
    assert_eq!(run["total_net"], json!(0), "a run total cannot outlive the slips behind it");
}

#[tokio::test]
async fn completing_a_till_sale_takes_the_goods_off_the_shelf_once() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "till").await;

    let (_, item) = call(
        &app,
        send("POST", "/api/e/inventory.items", &owner, json!({ "name": "Tinned beans", "sku": "TB-1" })),
    )
    .await;
    let item_id = item["id"].as_str().unwrap().to_string();

    call(
        &app,
        send("POST", "/api/e/inventory.stock_moves", &owner, json!({
            "item_id": item_id, "move_type": "purchase", "quantity": "100", "moved_on": "2026-03-01"
        })),
    )
    .await;

    let (_, sale) = call(
        &app,
        send("POST", "/api/e/sales.counter_sales", &owner, json!({
            "sold_at": "2026-03-02T10:15:00Z", "payment_method": "cash", "amount_tendered": "20"
        })),
    )
    .await;
    let sale_id = sale["id"].as_str().unwrap().to_string();
    assert!(
        sale["number"].as_str().unwrap_or("").starts_with("RC-"),
        "a receipt numbers itself; the till cannot ask the cashier for one"
    );

    call(
        &app,
        send("POST", "/api/e/sales.counter_sale_items", &owner, json!({
            "counter_sale_id": sale_id, "item_id": item_id,
            "description": "Tinned beans", "quantity": "3", "unit_price": "4.50"
        })),
    )
    .await;

    let (_, sale) = call(&app, get(&format!("/api/e/sales.counter_sales/{sale_id}"), &owner)).await;
    assert_eq!(sale["total"], json!(1_350), "three at 4.50 is 13.50");

    // Still open: nothing has left the shelf.
    let (_, it) = call(&app, get(&format!("/api/e/inventory.items/{item_id}"), &owner)).await;
    assert_eq!(it["stock_on_hand"], json!(100_000), "an open sale has not been handed over yet");

    // Complete it.
    call(
        &app,
        send("PATCH", &format!("/api/e/sales.counter_sales/{sale_id}"), &owner, json!({ "status": "completed" })),
    )
    .await;
    let (_, it) = call(&app, get(&format!("/api/e/inventory.items/{item_id}"), &owner)).await;
    assert_eq!(it["stock_on_hand"], json!(97_000), "three tins left the shelf");

    let (_, sale) = call(&app, get(&format!("/api/e/sales.counter_sales/{sale_id}"), &owner)).await;
    assert_eq!(sale["change_given"], json!(650), "twenty tendered against 13.50 is 6.50 change");

    // Editing a completed sale must not sell the same tins again.
    call(
        &app,
        send("PATCH", &format!("/api/e/sales.counter_sales/{sale_id}"), &owner, json!({ "notes": "regular" })),
    )
    .await;
    let (_, it) = call(&app, get(&format!("/api/e/inventory.items/{item_id}"), &owner)).await;
    assert_eq!(it["stock_on_hand"], json!(97_000), "the same goods cannot leave the shelf twice");

    // Voiding puts them back, or the ledger stops matching the shelf.
    call(
        &app,
        send("PATCH", &format!("/api/e/sales.counter_sales/{sale_id}"), &owner, json!({ "status": "voided" })),
    )
    .await;
    let (_, it) = call(&app, get(&format!("/api/e/inventory.items/{item_id}"), &owner)).await;
    assert_eq!(it["stock_on_hand"], json!(100_000), "a voided sale did not happen");
}

#[tokio::test]
async fn a_till_sale_needs_no_customer() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "anon").await;

    let (status, sale) = call(
        &app,
        send("POST", "/api/e/sales.counter_sales", &owner, json!({
            "sold_at": "2026-03-02T10:15:00Z"
        })),
    )
    .await;
    assert!(
        status.is_success(),
        "a shop does not learn the name of most people it sells to: {sale:?}"
    );
}

#[tokio::test]
async fn selling_a_service_does_not_move_stock() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "services").await;

    let (_, svc) = call(
        &app,
        send("POST", "/api/e/inventory.items", &owner, json!({
            "name": "Callout fee", "sku": "SVC-1", "item_type": "service", "sell_price": "60"
        })),
    )
    .await;
    let svc_id = svc["id"].as_str().unwrap().to_string();

    let (_, sale) = call(
        &app,
        send("POST", "/api/e/sales.counter_sales", &owner, json!({ "sold_at": "2026-03-02T10:00:00Z" })),
    )
    .await;
    let sale_id = sale["id"].as_str().unwrap().to_string();

    call(
        &app,
        send("POST", "/api/e/sales.counter_sale_items", &owner, json!({
            "counter_sale_id": sale_id, "item_id": svc_id,
            "description": "Callout fee", "quantity": "4", "unit_price": "60"
        })),
    )
    .await;
    call(
        &app,
        send("PATCH", &format!("/api/e/sales.counter_sales/{sale_id}"), &owner, json!({ "status": "completed" })),
    )
    .await;

    let (_, svc) = call(&app, get(&format!("/api/e/inventory.items/{svc_id}"), &owner)).await;
    assert_eq!(
        svc["stock_on_hand"], json!(0),
        "an hour of labour sold four times is not minus four of it on the shelf"
    );
}

#[tokio::test]
async fn a_barcode_finds_the_item_the_way_a_scanner_would() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "scan").await;

    call(
        &app,
        send("POST", "/api/e/inventory.items", &owner, json!({
            "name": "Tinned beans", "sku": "TB-1", "barcode": "5012345678900", "sell_price": "1.20"
        })),
    )
    .await;
    call(
        &app,
        send("POST", "/api/e/inventory.items", &owner, json!({
            "name": "Tinned tomatoes", "sku": "TT-1", "barcode": "5012345678917", "sell_price": "0.95"
        })),
    )
    .await;

    // A scanner types the number and presses Enter; one exact hit is what makes
    // ringing it up automatic rather than a choice.
    let (_, hit) = call(&app, get("/api/e/inventory.items?q=5012345678900", &owner)).await;
    assert_eq!(hit["data"].as_array().unwrap().len(), 1, "a barcode identifies exactly one product");
    assert_eq!(hit["data"][0]["name"], json!("Tinned beans"));

    // The business's own code still works, because that is what staff type.
    let (_, by_sku) = call(&app, get("/api/e/inventory.items?q=TT-1", &owner)).await;
    assert_eq!(by_sku["data"][0]["name"], json!("Tinned tomatoes"), "sku and barcode are different codes");
}

#[tokio::test]
async fn one_person_can_run_two_businesses_and_be_staff_in_both() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "firstco").await;

    // A second business under the same login.
    let (status, second) = call(
        &app,
        send("POST", "/api/auth/workspaces", &owner, json!({ "organization": "Second Co", "currency": "GBP" })),
    )
    .await;
    assert!(status.is_success(), "starting another business must not need another account: {second:?}");

    let second_token = second["access_token"].as_str().unwrap().to_string();
    let second_org = second["organization"]["id"].as_str().unwrap().to_string();
    assert_eq!(second["organization"]["name"], json!("Second Co"));

    let (_, whoami) = call(&app, get("/api/auth/me", &second_token)).await;
    assert_eq!(whoami["is_owner"], json!(true), "you own what you start");

    // The session came back scoped to the new workspace, and it is empty.
    let (_, list) = call(&app, get("/api/e/crm.accounts", &second_token)).await;
    assert_eq!(
        list["data"].as_array().unwrap().len(), 0,
        "a new business starts empty, whatever the first one holds"
    );

    // Owner of a business can also be on its payroll, with a job title.
    let (emp_status, emp) = call(
        &app,
        send("POST", "/api/e/hr.employees", &second_token, json!({
            "full_name": "Sam Rivera", "designation": "Managing Director"
        })),
    )
    .await;
    assert!(emp_status.is_success(), "an owner is often also staff: {emp:?}");
    assert_eq!(emp["designation"], json!("Managing Director"));

    // And in the first business, with a different title.
    let (_, emp2) = call(
        &app,
        send("POST", "/api/e/hr.employees", &owner, json!({
            "full_name": "Sam Rivera", "designation": "Weekend cover"
        })),
    )
    .await;
    assert_eq!(
        emp2["designation"], json!("Weekend cover"),
        "the same person holds a different job in each business"
    );

    // Both workspaces are listed, and switching between them works.
    let (_, me) = call(&app, get("/api/auth/me", &owner)).await;
    assert_eq!(me["organizations"].as_array().unwrap().len(), 2);

    let (sw, switched) = call(
        &app,
        send("POST", "/api/auth/switch", &owner, json!({ "organization_id": second_org })),
    )
    .await;
    assert!(sw.is_success(), "switching to your own workspace: {switched:?}");
    assert_eq!(switched["organization"]["name"], json!("Second Co"));
}

#[tokio::test]
async fn you_cannot_switch_into_a_business_you_do_not_belong_to() {
    let (app, _state) = test_app().await;
    let mine = new_org(&app, "mine").await;
    let theirs = new_org(&app, "theirs").await;

    let (_, them) = call(&app, get("/api/auth/me", &theirs)).await;
    let their_org = them["organization"]["id"].as_str().unwrap().to_string();

    let (status, _) = call(
        &app,
        send("POST", "/api/auth/switch", &mine, json!({ "organization_id": their_org })),
    )
    .await;
    assert_eq!(
        status, StatusCode::FORBIDDEN,
        "membership is checked on the server; a token for one business must never reach another"
    );
}

#[tokio::test]
async fn an_employee_needs_a_job_title() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "titles").await;

    let (status, body) = call(
        &app,
        send("POST", "/api/e/hr.employees", &owner, json!({ "full_name": "No Title" })),
    )
    .await;
    assert!(
        !status.is_success(),
        "a name with no job title is not a staff record: {body:?}"
    );
}

#[tokio::test]
async fn an_invitation_waits_inside_the_app_not_only_in_an_inbox() {
    let (app, _state) = test_app().await;
    let host = new_org(&app, "hostco").await;

    // Someone who already has their own business.
    let guest_email = format!("guest{}@example.com", 1);
    let (_, guest_reg) = call(
        &app,
        send("POST", "/api/auth/register", "", json!({
            "name": "Guest Owner", "organization": "Guest Co",
            "email": guest_email, "password": "hunter2hunter2"
        })),
    )
    .await;
    let guest = guest_reg["access_token"].as_str().unwrap().to_string();

    // Nothing pending yet.
    let (_, none) = call(&app, get("/api/my-invitations", &guest)).await;
    assert_eq!(none["data"].as_array().unwrap().len(), 0);

    // The host invites that address.
    let (_, roles) = call(&app, get("/api/settings/roles", &host)).await;
    let role_id = roles["data"][0]["id"].as_str().unwrap().to_string();
    let (inv_status, _inv) = call(
        &app,
        send("POST", "/api/settings/invitations", &host, json!({
            "email": guest_email, "role_id": role_id, "title": "Bookkeeper"
        })),
    )
    .await;
    assert!(inv_status.is_success(), "the host can invite");

    // It shows up for them, signed in, with no link to hunt for.
    let (_, waiting) = call(&app, get("/api/my-invitations", &guest)).await;
    let list = waiting["data"].as_array().unwrap();
    assert_eq!(list.len(), 1, "an invitation to my address is mine to see");
    let invite_id = list[0]["id"].as_str().unwrap().to_string();

    // Somebody else's session must not be able to take it.
    let (stolen, _) = call(
        &app,
        send("POST", &format!("/api/my-invitations/{invite_id}/accept"), &host, Value::Null),
    )
    .await;
    assert_eq!(
        stolen, StatusCode::FORBIDDEN,
        "an invitation belongs to the address it was sent to, not to whoever has its id"
    );

    // The invitee accepts, and now belongs to both businesses.
    let (ok, joined) = call(
        &app,
        send("POST", &format!("/api/my-invitations/{invite_id}/accept"), &guest, Value::Null),
    )
    .await;
    assert!(ok.is_success(), "accepting my own invitation: {joined:?}");

    let (_, me) = call(&app, get("/api/auth/me", &guest)).await;
    assert_eq!(
        me["organizations"].as_array().unwrap().len(), 2,
        "one login, their own business and the one they were invited to"
    );

    // And it is gone from the waiting list rather than offered twice.
    let (_, after) = call(&app, get("/api/my-invitations", &guest)).await;
    assert_eq!(after["data"].as_array().unwrap().len(), 0, "an accepted invitation stops waiting");
}

#[tokio::test]
async fn an_account_with_no_business_can_do_nothing_but_choose_one() {
    let (app, _state) = test_app().await;

    // Signing up without naming a business: the invited person's path.
    let (status, reg) = call(
        &app,
        send("POST", "/api/auth/register", "", json!({
            "name": "Dana Reyes", "email": "dana@example.com", "password": "hunter2hunter2"
        })),
    )
    .await;
    assert!(status.is_success(), "an account is a thing you can have on its own: {reg:?}");

    let token = reg["access_token"].as_str().unwrap().to_string();

    // The session is real, and honest about belonging nowhere.
    let (_, me) = call(&app, get("/api/auth/me", &token)).await;
    assert_eq!(me["organization"], Value::Null, "no business chosen yet");
    assert_eq!(me["organizations"].as_array().unwrap().len(), 0);
    assert_eq!(me["permissions"].as_array().unwrap().len(), 0, "no membership, no permissions");

    // And it cannot touch a single row of anyone's data. This is the property
    // the whole change rests on: no membership means no Ctx, and no Ctx means
    // no tenant route will serve it.
    for path in ["/api/e/crm.accounts", "/api/e/books.invoices", "/api/e/hr.employees"] {
        let (s, _) = call(&app, get(path, &token)).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "{path} must refuse a session with no business");
    }
    let (write, _) = call(
        &app,
        send("POST", "/api/e/crm.accounts", &token, json!({ "name": "Sneaky Ltd" })),
    )
    .await;
    assert_eq!(write, StatusCode::UNAUTHORIZED, "and certainly must not let it write");

    // What it can do is start one.
    let (made, created) = call(
        &app,
        send("POST", "/api/auth/workspaces", &token, json!({ "organization": "Dana Design" })),
    )
    .await;
    assert!(made.is_success(), "choosing to start a business: {created:?}");

    let with_org = created["access_token"].as_str().unwrap().to_string();
    let (ok, _) = call(&app, get("/api/e/crm.accounts", &with_org)).await;
    assert!(ok.is_success(), "and then the app opens up");
}

#[tokio::test]
async fn signing_in_before_accepting_an_invitation_works() {
    let (app, _state) = test_app().await;

    call(
        &app,
        send("POST", "/api/auth/register", "", json!({
            "name": "Dana Reyes", "email": "dana@example.com", "password": "hunter2hunter2"
        })),
    )
    .await;

    // Signing out and back in must not strand someone who belongs nowhere yet.
    let (status, login) = call(
        &app,
        send("POST", "/api/auth/login", "", json!({
            "email": "dana@example.com", "password": "hunter2hunter2"
        })),
    )
    .await;
    assert!(
        status.is_success(),
        "belonging to nothing is a state to sign in to, not an error: {login:?}"
    );
    assert_eq!(login["organization"], Value::Null);
}

#[tokio::test]
async fn a_person_is_named_once_not_three_times() {
    let (app, _state) = test_app().await;
    let owner = new_org(&app, "names").await;

    // The form no longer offers full_name at all; first and last are enough.
    let (status, lead) = call(
        &app,
        send("POST", "/api/e/crm.leads", &owner, json!({
            "first_name": "Ada", "last_name": "Lovelace", "company": "Analytical Engines"
        })),
    )
    .await;
    assert!(status.is_success(), "a lead needs a name, not three of them: {lead:?}");
    assert_eq!(lead["full_name"], json!("Ada Lovelace"), "composed, not typed");

    // Correcting the surname has to move the title with it, or the list keeps
    // showing the old name and search keeps finding it under that.
    let id = lead["id"].as_str().unwrap().to_string();
    call(
        &app,
        send("PATCH", &format!("/api/e/crm.leads/{id}"), &owner, json!({ "last_name": "Byron" })),
    )
    .await;
    let (_, fixed) = call(&app, get(&format!("/api/e/crm.leads/{id}"), &owner)).await;
    assert_eq!(fixed["full_name"], json!("Ada Byron"), "the composed name follows its parts");

    // A mononym is a real name and must not come out with a leading space.
    let (_, mono) = call(
        &app,
        send("POST", "/api/e/crm.contacts", &owner, json!({ "last_name": "Prince" })),
    )
    .await;
    assert_eq!(mono["full_name"], json!("Prince"));

    // And whatever the client sends for the composed field is ignored.
    let (_, liar) = call(
        &app,
        send("POST", "/api/e/crm.contacts", &owner, json!({
            "first_name": "Grace", "last_name": "Hopper", "full_name": "Somebody Else"
        })),
    )
    .await;
    assert_eq!(liar["full_name"], json!("Grace Hopper"), "the server owns this column");
}
