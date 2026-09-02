use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("{0} not found")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("validation failed")]
    Validation(Vec<FieldError>),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, Serialize, Clone)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

impl FieldError {
    pub fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self { field: field.into(), message: message.into() }
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    fields: Option<Vec<FieldError>>,
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        AppError::BadRequest(msg.into())
    }
    pub fn not_found(what: impl Into<String>) -> Self {
        AppError::NotFound(what.into())
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        AppError::Conflict(msg.into())
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        AppError::Forbidden(msg.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, fields) = match &self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, "bad_request", m.clone(), None),
            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Authentication required".to_string(),
                None,
            ),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, "forbidden", m.clone(), None),
            AppError::NotFound(m) => (
                StatusCode::NOT_FOUND,
                "not_found",
                format!("{m} not found"),
                None,
            ),
            AppError::Conflict(m) => (StatusCode::CONFLICT, "conflict", m.clone(), None),
            AppError::Validation(f) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_failed",
                "Validation failed".to_string(),
                Some(f.clone()),
            ),
            AppError::Db(e) => {
                // Surface constraint violations as 409 rather than a blanket 500.
                if let sqlx::Error::Database(db) = e {
                    let msg = db.message().to_string();
                    if msg.contains("UNIQUE constraint failed") {
                        (
                            StatusCode::CONFLICT,
                            "conflict",
                            format!("A record with these values already exists ({msg})"),
                            None,
                        )
                    } else if msg.contains("FOREIGN KEY constraint failed") {
                        (
                            StatusCode::CONFLICT,
                            "conflict",
                            "Referenced record does not exist, or is still in use".to_string(),
                            None,
                        )
                    } else {
                        tracing::error!(error = %e, "database error");
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "internal_error",
                            "Internal server error".to_string(),
                            None,
                        )
                    }
                } else {
                    tracing::error!(error = %e, "database error");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "internal_error",
                        "Internal server error".to_string(),
                        None,
                    )
                }
            }
            AppError::Other(e) => {
                tracing::error!(error = ?e, "unhandled error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "Internal server error".to_string(),
                    None,
                )
            }
        };

        (status, Json(ErrorBody { error: ErrorDetail { code, message, fields } })).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
