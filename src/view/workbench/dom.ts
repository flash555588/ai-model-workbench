/**
 * Minimal hyperscript helper (~60 lines).
 * Creates DOM elements from tag, props, and children.
 * Used by htm via h.ts.
 */

type Props = Record<string, unknown> | null;
type Child = Node | Child[] | string | number | boolean | null | undefined;
type ComponentFn = (props: Record<string, unknown>) => HTMLElement;

export function createElement(
  tag: string | ComponentFn,
  props: Props,
  ...children: Child[]
): HTMLElement | HTMLElement[] {
  // Component function
  if (typeof tag === "function") {
    return tag({ ...props, children });
  }

  // Staging container: elements created here are later inserted into the live DOM
  // by htm's template processing, at which point they inherit Obsidian CSS variables.
  const staging = createDiv();
  const el = staging.createEl(tag as keyof HTMLElementTagNameMap);

  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (key === "ref" && typeof val === "function") {
        (val as (el: HTMLElement) => void)(el);
      } else if (key === "class" && typeof val === "string") {
        el.className = val;
      } else if (key === "className" && typeof val === "string") {
        el.className = val;
      } else if (key === "style" && typeof val === "object") {
        Object.assign(el.style, val);
      } else if (key === "attr" && isRecord(val)) {
        setAttributes(el, val);
      } else if (key === "dataset" && isRecord(val)) {
        setDataset(el, val);
      } else if (key.startsWith("on") && typeof val === "function") {
        const event = key.slice(2).toLowerCase();
        el.addEventListener(event, val as EventListener);
      } else if (key === "value" && "value" in el) {
        (el as HTMLInputElement).value = String(val);
      } else if (key === "checked" && "checked" in el) {
        (el as HTMLInputElement).checked = val as boolean;
      } else if (val === true) {
        el.setAttribute(key, "");
      } else if (val !== false && val != null) {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- intentional coercion for attribute values
        el.setAttribute(key, String(val));
      }
    }
  }

  appendChildren(el, children);
  return el;
}

function appendChildren(parent: HTMLElement, children: Child[]) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(parent, child);
    } else if (isNodeLike(child)) {
      parent.appendChild(child);
    } else {
      parent.appendChild(activeDocument.createTextNode(String(child)));
    }
  }
}

function setAttributes(el: HTMLElement, attrs: Record<string, unknown>): void {
  for (const [key, val] of Object.entries(attrs)) {
    if (val === true) {
      el.setAttribute(key, "");
    } else if (val !== false && val != null) {
      el.setAttribute(key, String(val));
    }
  }
}

function setDataset(el: HTMLElement, dataset: Record<string, unknown>): void {
  for (const [key, val] of Object.entries(dataset)) {
    if (val != null) {
      el.dataset[key] = String(val);
    }
  }
}

function isNodeLike(value: unknown): value is Node {
  if (!value || typeof value !== "object") return false;
  const nodeCtor = activeDocument.defaultView?.Node ?? Node;
  return value instanceof nodeCtor
    || ("nodeType" in value && typeof (value as Node).nodeType === "number" && "nodeName" in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
