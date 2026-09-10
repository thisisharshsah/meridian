use crate::engine::schema::*;

/// Rooms and stays, for anything let out by the night.
///
/// Deliberately not modelled as products and orders. A room is not stock — it
/// cannot be counted, only occupied — and a stay is not a sale until someone
/// leaves. Trying to force both through the catalogue is what makes general
/// business software unusable for a hotel.
pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "hospitality",
        label: "Rooms",
        icon: "BedDouble",
        color: "purple",
        description: "Rooms, bookings, arrivals and departures.",
    });

    r.add(EntityDef {
        key: "hospitality.rooms",
        table: "rooms",
        module: "hospitality",
        label: "Room",
        label_plural: "Rooms",
        icon: "DoorOpen",
        title_field: "number",
        fields: vec![
            text("number", "Room number").required().in_list(),
            select("room_type", "Type", vec![
                opt("single", "Single", "neutral"),
                opt("double", "Double", "brand"),
                opt("twin", "Twin", "info"),
                opt("suite", "Suite", "purple"),
                opt("family", "Family", "success"),
            ]).required().with_default("double").in_list(),
            int("floor", "Floor").in_list(),
            int("capacity", "Sleeps").in_list(),
            money("nightly_rate", "Rate per night").in_list(),
            select("status", "State", vec![
                opt("available", "In service", "success"),
                opt("maintenance", "Being cleaned or repaired", "warning"),
                opt("out_of_service", "Out of service", "danger"),
            ])
                .required()
                .with_default("available")
                .in_list()
                .help("A room out of service takes no bookings."),
            long_text("notes", "Notes"),
        ],
        default_sort: ("number", SortDir::Asc),
        children: vec![ChildDef {
            entity: "hospitality.reservations",
            foreign_key: "room_id",
            label: "Bookings",
            inline: false,
        }],
        has_activities: false,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "hospitality.reservations",
        table: "reservations",
        module: "hospitality",
        label: "Booking",
        label_plural: "Bookings",
        icon: "CalendarCheck",
        title_field: "guest_name",
        fields: vec![
            text("number", "Booking #").readonly().in_list(),
            text("guest_name", "Guest").required().in_list(),
            reference("room_id", "Room", "hospitality.rooms").required().in_list(),
            date("check_in", "Arrives").required().in_list(),
            date("check_out", "Leaves").required().in_list(),
            // Nights and total are arithmetic on the three fields above, so
            // nobody is asked to multiply and nobody can mistype the answer.
            int("nights", "Nights").readonly().in_list(),
            money("nightly_rate", "Rate per night")
                .help("Leave blank to use the room’s own rate."),
            money("total", "Total").readonly().in_list(),
            select("status", "Status", vec![
                opt("booked", "Booked", "info"),
                opt("checked_in", "Staying", "success"),
                opt("checked_out", "Left", "neutral"),
                opt("cancelled", "Cancelled", "neutral"),
                opt("no_show", "No show", "danger"),
            ]).required().with_default("booked").in_list(),
            int("adults", "Adults"),
            int("children", "Children"),
            phone("guest_phone", "Phone"),
            email("guest_email", "Email"),
            reference("account_id", "Company", "crm.accounts")
                .help("If a business is paying rather than the guest."),
            text("source", "Booked through").suggests(),
            long_text("notes", "Notes"),
        ],
        default_sort: ("check_in", SortDir::Desc),
        children: vec![],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });
}
