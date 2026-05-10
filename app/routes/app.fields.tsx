import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  EmptyState,
  FormLayout,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  deleteCustomField,
  listCustomFields,
  upsertCustomField,
  type FieldDescriptor,
} from "../lib/customField.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fields = await listCustomFields(session.shop);
  return { fields };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "save_field") {
    const id = String(formData.get("id") || "") || null;
    const result = await upsertCustomField(session.shop, {
      id,
      label: String(formData.get("label") || ""),
      fieldType: String(formData.get("fieldType") || "text"),
      optionsRaw: String(formData.get("optionsRaw") || ""),
      placeholder: String(formData.get("placeholder") || ""),
      required: formData.get("required") === "on",
      position: parseInt(String(formData.get("position") || "0"), 10) || 0,
    });
    return json(result);
  }

  if (intent === "delete_field") {
    const id = String(formData.get("id") || "");
    if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });
    await deleteCustomField(session.shop, id);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function CustomFieldsPage() {
  const { fields } = useLoaderData<typeof loader>();
  const [editing, setEditing] = useState<FieldDescriptor | "new" | null>(null);

  return (
    <Page
      title="Custom fields"
      subtitle="Extra inputs the customer fills in alongside name / email / phone on the quote page."
      primaryAction={{
        content: "Add field",
        onAction: () => setEditing("new"),
      }}
    >
      <Layout>
        <Layout.Section>
          {editing ? (
            <FieldForm
              field={editing === "new" ? null : editing}
              position={editing === "new" ? fields.length : editing.position}
              onClose={() => setEditing(null)}
            />
          ) : (
            <Card padding="0">
              {fields.length === 0 ? (
                <EmptyState
                  heading="No custom fields yet"
                  action={{
                    content: "Add field",
                    onAction: () => setEditing("new"),
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Add fields like "Company name", "Industry", or "Need by date"
                    and choose whether each is required.
                  </p>
                </EmptyState>
              ) : (
                <FieldList fields={fields} onEdit={setEditing} />
              )}
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function FieldList({
  fields,
  onEdit,
}: {
  fields: FieldDescriptor[];
  onEdit: (f: FieldDescriptor) => void;
}) {
  const deleteFetcher = useFetcher();
  const rows = fields.map((f, idx) => (
    <IndexTable.Row id={f.id} key={f.id} position={idx} onClick={() => onEdit(f)}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {f.label}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge>{f.fieldType}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {f.required ? <Badge tone="attention">Required</Badge> : <Badge>Optional</Badge>}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button onClick={() => onEdit(f)} size="slim">
            Edit
          </Button>
          <deleteFetcher.Form
            method="post"
            style={{ display: "inline-block" }}
            onSubmit={(e) => {
              if (!window.confirm(`Delete the "${f.label}" field?`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete_field" />
            <input type="hidden" name="id" value={f.id} />
            <Button
              submit
              size="slim"
              tone="critical"
              variant="plain"
              loading={deleteFetcher.state !== "idle"}
            >
              Delete
            </Button>
          </deleteFetcher.Form>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <IndexTable
      resourceName={{ singular: "field", plural: "fields" }}
      itemCount={fields.length}
      selectable={false}
      headings={[
        { title: "Label" },
        { title: "Type" },
        { title: "Required" },
        { title: "Actions" },
      ]}
    >
      {rows}
    </IndexTable>
  );
}

function FieldForm({
  field,
  position,
  onClose,
}: {
  field: FieldDescriptor | null;
  position: number;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [label, setLabel] = useState(field?.label ?? "");
  const [fieldType, setFieldType] = useState<string>(field?.fieldType ?? "text");
  const [optionsRaw, setOptionsRaw] = useState(
    field?.options.join("\n") ?? "",
  );
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? "");
  const [required, setRequired] = useState(field?.required ?? false);

  const isSelect = fieldType === "select";

  // Close on successful save.
  if (fetcher.data?.ok && fetcher.state === "idle") {
    setTimeout(onClose, 0);
  }

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {field ? "Edit field" : "New field"}
        </Text>
        {fetcher.data && !fetcher.data.ok && fetcher.data.error && (
          <Banner tone="critical">{fetcher.data.error}</Banner>
        )}
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save_field" />
          {field && <input type="hidden" name="id" value={field.id} />}
          <input type="hidden" name="position" value={String(position)} />
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Label"
                name="label"
                value={label}
                onChange={setLabel}
                autoComplete="off"
                helpText="Shown on the quote form, e.g. 'Company name'."
              />
              <Select
                label="Type"
                name="fieldType"
                options={[
                  { label: "Single line", value: "text" },
                  { label: "Multi-line", value: "textarea" },
                  { label: "Email", value: "email" },
                  { label: "Phone", value: "tel" },
                  { label: "Dropdown", value: "select" },
                ]}
                value={fieldType}
                onChange={setFieldType}
              />
            </FormLayout.Group>
            <TextField
              label="Placeholder (optional)"
              name="placeholder"
              value={placeholder}
              onChange={setPlaceholder}
              autoComplete="off"
            />
            {isSelect && (
              <TextField
                label="Options"
                name="optionsRaw"
                value={optionsRaw}
                onChange={setOptionsRaw}
                multiline={4}
                autoComplete="off"
                helpText="One option per line (or comma-separated)."
                placeholder={"Option A\nOption B\nOption C"}
              />
            )}
            <Checkbox
              label="Required"
              name="required"
              checked={required}
              onChange={setRequired}
              helpText="The customer can't submit the quote without filling this in."
            />
            <InlineStack gap="200">
              <Button submit variant="primary" loading={fetcher.state !== "idle"}>
                {field ? "Save changes" : "Add field"}
              </Button>
              <Button onClick={onClose}>Cancel</Button>
            </InlineStack>
          </FormLayout>
        </fetcher.Form>
      </BlockStack>
    </Card>
  );
}

