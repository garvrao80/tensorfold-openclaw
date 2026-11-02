import type {
  ControlUiHost,
  ControlUiView,
} from "openclaw/plugin-sdk/control-ui";
import type { Telemetry } from "./contracts.js";

const labels: Record<string, string> = {
  running: "Active streams",
  waiting: "Queued requests",
  decode_tokens_per_second: "Decode tokens / s",
  prefill_tokens_per_second: "Prefill tokens / s",
  prompt_tokens_total: "Prompt tokens",
  generation_tokens_total: "Generated tokens",
  "device.active_bytes": "Device memory in use",
  "device.cache_bytes": "Device cache",
  "device.peak_bytes": "Device memory peak",
  "device.load_limit_bytes": "Device load limit",
  "process.physical_footprint_bytes": "Process footprint",
  "prompt_cache_plan.budget_bytes": "Prompt cache budget",
};

export const mountDashboard: ControlUiView = (container, initial) => {
  let context = initial;
  let disposed = false;
  let busy = false;
  let startingChat = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let models: Telemetry["models"] = [];
  const root = document.createElement("section");
  root.className = "tf-dashboard";
  root.innerHTML = `<header><div><p class="tf-eyebrow">LOCAL INFERENCE</p><h1>TensorFold</h1><p class="tf-endpoint">Connecting to your server…</p></div><button class="tf-refresh" type="button">Refresh</button></header>
    <p class="tf-status" role="status" aria-live="polite">Loading server status…</p>
    <div class="tf-model"><label for="tf-model-picker">Served model</label><select id="tf-model-picker" aria-label="TensorFold model"></select><button class="tf-chat" type="button" disabled>Start a new chat</button><p class="tf-model-note"></p></div>
    <div class="tf-metrics" aria-label="Server measurements"></div><p class="tf-notes"></p><footer>Measurements come from your local TensorFold server. Unreported values stay unavailable.</footer>`;
  container.replaceChildren(root);
  const get = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(name)!;
  const status = get<HTMLParagraphElement>(".tf-status");
  const picker = get<HTMLSelectElement>("select");
  const refresh = get<HTMLButtonElement>(".tf-refresh");
  const chat = get<HTMLButtonElement>(".tf-chat");
  const metrics = get<HTMLDivElement>(".tf-metrics");
  const alive = () => !disposed && !context.signal.aborted;
  const permitted = () =>
    alive() &&
    context.presented &&
    context.host.connection.connected &&
    context.host.connection.canRead;
  const selected = () => {
    const row = models.find((model) => model.id === picker.value);
    get(".tf-model-note").textContent = row
      ? `${row.contextWindow.toLocaleString()} token context · ${row.reasoning ? "Reasoning metadata available" : "Text model"}`
      : "No served models discovered.";
    chat.disabled =
      !row ||
      !context.host.connection.canWrite ||
      busy ||
      startingChat ||
      !permitted();
  };
  const schedule = () => {
    if (permitted()) timer = setTimeout(() => void load(), 5000);
  };
  async function load() {
    if (timer) clearTimeout(timer);
    if (busy || !permitted()) return;
    busy = true;
    refresh.disabled = true;
    const version = ++generation;
    try {
      const snapshot = await context.host.request<Telemetry>(
        "tensorfold.snapshot",
      );
      if (!permitted() || version !== generation) return;
      const previous = picker.value;
      models = snapshot.models;
      picker.replaceChildren(
        ...models.map((model) => {
          const option = document.createElement("option");
          option.value = model.id;
          option.textContent = model.id;
          return option;
        }),
      );
      if (models.some((model) => model.id === previous))
        picker.value = previous;
      get(".tf-endpoint").textContent = snapshot.baseUrl;
      status.textContent =
        snapshot.health.state === "ok"
          ? `Connected · updated ${new Date(snapshot.observedAt).toLocaleTimeString()}`
          : (snapshot.health.message ?? "Server unavailable");
      status.dataset.state = snapshot.health.state;
      metrics.replaceChildren();
      const values = { ...snapshot.stats.values, ...snapshot.memory.values };
      for (const [key, label] of Object.entries(labels)) {
        const card = document.createElement("article");
        const title = document.createElement("span");
        title.textContent = label;
        const value = document.createElement("strong");
        const number = values[key];
        value.textContent =
          number === undefined
            ? "Unavailable"
            : key.endsWith("bytes")
              ? `${(number / 1024 ** 3).toFixed(2)} GiB`
              : number.toLocaleString(undefined, { maximumFractionDigits: 1 });
        card.append(title, value);
        metrics.append(card);
      }
      get(".tf-notes").textContent = [
        snapshot.stats.message,
        snapshot.memory.message,
      ]
        .filter(Boolean)
        .join(" ");
    } catch {
      if (!permitted() || version !== generation) return;
      status.textContent =
        "Cannot reach TensorFold. Check the server, provider API key, and loopback URL, then refresh.";
      status.dataset.state = "unavailable";
      metrics.replaceChildren();
      models = [];
      picker.replaceChildren();
      get(".tf-notes").textContent = "";
    } finally {
      busy = false;
      if (alive()) {
        refresh.disabled = !permitted();
        selected();
        schedule();
      }
    }
  }
  const stop = () => {
    disposed = true;
    generation++;
    if (timer) clearTimeout(timer);
  };
  context.signal.addEventListener("abort", stop, { once: true });
  refresh.onclick = () => void load();
  picker.onchange = selected;
  chat.onclick = async () => {
    const model = picker.value;
    if (
      startingChat ||
      !permitted() ||
      !context.host.connection.canWrite ||
      !models.some((row) => row.id === model)
    )
      return;
    startingChat = true;
    chat.disabled = true;
    const host = context.host;
    const agentId =
      host.agents.selectedId ?? host.agents.defaultId ?? undefined;
    try {
      const sessionKey = await host.sessions.create({
        agentId,
        displayName: "TensorFold",
      });
      if (!sessionKey || !alive()) return;
      await host.sessions.patch(
        { sessionKey, agentId },
        { model: `tensorfold/${model}` },
      );
      if (alive()) host.sessions.open({ sessionKey, agentId });
    } catch {
      if (alive())
        status.textContent =
          "Could not select the model. Your existing chats were not changed; retry or use OpenClaw's model picker.";
    } finally {
      startingChat = false;
      if (alive()) selected();
    }
  };
  const unsubscribe = context.host.subscribe(() => {
    selected();
    if (permitted()) void load();
    else if (timer) clearTimeout(timer);
  });
  void load();
  return {
    update(next) {
      context = next;
      selected();
      if (permitted()) void load();
      else if (timer) clearTimeout(timer);
    },
    dispose() {
      stop();
      unsubscribe();
      context.signal.removeEventListener("abort", stop);
      root.remove();
    },
  };
};

export function activate(host: ControlUiHost): () => void {
  const page = host.ui.registerPage({
    id: "tensorfold",
    label: "TensorFold",
    mount: mountDashboard,
  });
  const navigation = host.ui.registerNavigation({
    id: "tensorfold",
    label: "TensorFold",
    icon: "cpu",
    page: { id: "tensorfold" },
    order: 60,
  });
  return () => {
    navigation();
    page();
  };
}
