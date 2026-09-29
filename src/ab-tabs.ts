import { isJsonObject, isString } from "./json.ts";
import { StalePage, type JsonValue, type PageState } from "./types.ts";

type Tab = { id: string; title: string; url: string; active: boolean };

function parseTabs(value: JsonValue): Tab[] {
  if (!isJsonObject(value) || !Array.isArray(value.tabs)) throw new Error("Invalid agent-browser tab list");

  return value.tabs.map(tab => {
    if (!isJsonObject(tab) || !isString(tab.targetId) || !isString(tab.title) || !isString(tab.url) || (tab.active !== true && tab.active !== false)) {
      throw new Error("Invalid agent-browser tab");
    }

    return { id: tab.targetId, title: tab.title, url: tab.url, active: tab.active };
  });
}

export class BrowserTabs {
  private seen: Set<string> | null = null;

  constructor(private run: (args: string[]) => Promise<JsonValue>) {}

  async refresh(): Promise<Tab[]> {
    const tabs = parseTabs(await this.run(["tab", "list"]));
    const added = this.seen ? tabs.filter(tab => !this.seen?.has(tab.id)) : [];
    this.seen = new Set(tabs.map(tab => tab.id));
    const newest = added.at(-1);

    if (newest && !newest.active) {
      await this.run(["tab", newest.id]);

      for (const tab of tabs) tab.active = tab.id === newest.id;
    }

    return tabs;
  }

  async focus(id: string): Promise<void> {
    const tabs = parseTabs(await this.run(["tab", "list"]));

    if (!tabs.some(tab => tab.id === id)) throw new StalePage("Tab is gone. Observe again.");
    await this.run(["tab", id]);
  }

  decorate(page: PageState, tabs: Tab[]): void {
    if (tabs.length < 2) return;
    page.tabs = tabs.map(tab => ({ title: tab.title.slice(0, 80), url: tab.url.slice(0, 200), ...(tab.active && { current: true }) }));

    for (const [index, tab] of tabs.entries()) {
      if (!tab.active) page.actions.push({ id: `focus_tab_${index}`, kind: "focus_tab", label: `Switch to tab: ${(tab.title || tab.url).slice(0, 90)}`, value: tab.id });
    }
  }
}
