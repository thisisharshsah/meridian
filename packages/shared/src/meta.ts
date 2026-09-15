/** Mirrors the Rust `EntityDef` serialization in `engine::schema`. */

export type SelectOption = { value: string; label: string; tone: string };

export type FieldKind =
  | { type: "text" }
  | { type: "long_text" }
  | { type: "email" }
  | { type: "phone" }
  | { type: "url" }
  | { type: "int" }
  | { type: "money" }
  | { type: "percent" }
  | { type: "quantity" }
  | { type: "bool" }
  | { type: "date" }
  | { type: "date_time" }
  | { type: "select"; options: SelectOption[] }
  | { type: "ref"; entity: string }
  | { type: "json" };

export type FieldDef = {
  name: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  in_list: boolean;
  searchable: boolean;
  sortable: boolean;
  readonly: boolean;
  /** Mirrors the column's SQL DEFAULT; used to seed a new-record form. */
  default: string | null;
  help: string | null;
  /** Offer values already used in this workspace, while still allowing new ones. */
  suggest: boolean;
};

export type ChildDef = {
  entity: string;
  foreign_key: string;
  label: string;
  inline: boolean;
};

export type EntityMeta = {
  key: string;
  module: string;
  table: string;
  label: string;
  label_plural: string;
  icon: string;
  title_field: string;
  fields: FieldDef[];
  children: ChildDef[];
  default_sort: { field: string; dir: "asc" | "desc" };
  has_activities: boolean;
  has_notes: boolean;
  permissions: { view: boolean; create: boolean; edit: boolean; delete: boolean };
};

export type ModuleEntity = {
  key: string;
  label: string;
  label_plural: string;
  icon: string;
};

export type ModuleMeta = {
  key: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  entities: ModuleEntity[];
};

export type AppMeta = { modules: ModuleMeta[] };

export type Session = {
  user: { id: string; name: string; email: string; avatar_url: string | null };
  /** Null until the person has started a business or accepted an invitation. */
  organization: {
    id: string; name: string; slug: string; currency: string; timezone: string;
    /** 1-12. The month the business's financial year starts in. */
    fiscal_year_start_month: number;
  } | null;
  /** What this installation's copy of the product is called. */
  product: string;
  role: string | null;
  organizations: { id: string; name: string; slug: string }[];
  is_owner: boolean;
  permissions: string[];
};

/** `crm.leads` <-> `/crm/leads` */
export function entityPath(key: string) {
  return `/${key.replace(".", "/")}`;
}

export function entityKeyFrom(module: string, entity: string) {
  return `${module}.${entity}`;
}

export function fieldIsNumeric(kind: FieldKind) {
  return ["int", "money", "percent", "quantity"].includes(kind.type);
}

export function optionsOf(field: FieldDef): SelectOption[] {
  return field.kind.type === "select" ? field.kind.options : [];
}

export function optionFor(field: FieldDef, value: unknown) {
  return optionsOf(field).find((o) => o.value === value);
}
