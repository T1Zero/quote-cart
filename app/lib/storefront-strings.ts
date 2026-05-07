/**
 * Catalog of every storefront string Quote Cart renders, with the default
 * English and Bulgarian values shipped in the locale files.
 *
 * Used by the Translations tab to show a side-by-side editor and by the
 * App Proxy strings endpoint to serve merchant overrides.
 */

export type StringKey =
  | "block.add_to_quote"
  | "block.quantity_label"
  | "popup.added"
  | "popup.continue_shopping"
  | "popup.view_quote"
  | "popup.close"
  | "drawer.your_quote"
  | "drawer.empty"
  | "drawer.subtotal"
  | "drawer.view_full_quote"
  | "drawer.continue_shopping"
  | "drawer.remove"
  | "drawer.qty"
  | "launcher.open"
  | "launcher.close";

export type StringDescriptor = {
  key: StringKey;
  group: "Button" | "Popup" | "Drawer" | "Launcher";
  label: string;
  defaultEn: string;
  defaultBg: string;
};

export const STOREFRONT_STRINGS: StringDescriptor[] = [
  {
    key: "block.add_to_quote",
    group: "Button",
    label: "Add to Quote button label (default)",
    defaultEn: "Add to Quote",
    defaultBg: "Добави към заявка",
  },
  {
    key: "block.quantity_label",
    group: "Button",
    label: "Quantity field label",
    defaultEn: "Quantity",
    defaultBg: "Количество",
  },
  {
    key: "popup.added",
    group: "Popup",
    label: "Confirmation title",
    defaultEn: "Product added to your quote",
    defaultBg: "Продуктът е добавен към заявката",
  },
  {
    key: "popup.continue_shopping",
    group: "Popup",
    label: "Continue shopping button",
    defaultEn: "Continue Shopping",
    defaultBg: "Продължи пазаруването",
  },
  {
    key: "popup.view_quote",
    group: "Popup",
    label: "View quote button",
    defaultEn: "View Quote",
    defaultBg: "Виж заявката",
  },
  {
    key: "popup.close",
    group: "Popup",
    label: "Close button (aria-label)",
    defaultEn: "Close",
    defaultBg: "Затвори",
  },
  {
    key: "drawer.your_quote",
    group: "Drawer",
    label: "Drawer heading",
    defaultEn: "Your Quote",
    defaultBg: "Вашата заявка",
  },
  {
    key: "drawer.empty",
    group: "Drawer",
    label: "Empty-state message",
    defaultEn: "Your quote is empty.",
    defaultBg: "Вашата заявка е празна.",
  },
  {
    key: "drawer.subtotal",
    group: "Drawer",
    label: "Subtotal label",
    defaultEn: "Subtotal",
    defaultBg: "Междинна сума",
  },
  {
    key: "drawer.view_full_quote",
    group: "Drawer",
    label: "View full quote button",
    defaultEn: "View Full Quote",
    defaultBg: "Виж пълната заявка",
  },
  {
    key: "drawer.continue_shopping",
    group: "Drawer",
    label: "Continue shopping button",
    defaultEn: "Continue Shopping",
    defaultBg: "Продължи пазаруването",
  },
  {
    key: "drawer.remove",
    group: "Drawer",
    label: "Remove item button (aria-label)",
    defaultEn: "Remove",
    defaultBg: "Премахни",
  },
  {
    key: "drawer.qty",
    group: "Drawer",
    label: "Quantity stepper aria-label",
    defaultEn: "Quantity",
    defaultBg: "Количество",
  },
  {
    key: "launcher.open",
    group: "Launcher",
    label: "Open quote (aria-label)",
    defaultEn: "Open quote",
    defaultBg: "Отвори заявката",
  },
  {
    key: "launcher.close",
    group: "Launcher",
    label: "Close quote (aria-label)",
    defaultEn: "Close quote",
    defaultBg: "Затвори заявката",
  },
];

export const STRING_GROUPS = ["Button", "Popup", "Drawer", "Launcher"] as const;

export function parseOverrides(raw: string): Partial<Record<StringKey, string>> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<StringKey, string>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k as StringKey] = v;
    }
    return out;
  } catch {
    return {};
  }
}
