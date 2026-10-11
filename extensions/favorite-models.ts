/**
 * Favorite Models Extension (with integrated cost tiers)
 *
 * Mark often-used models as favorites and pick them from a dedicated selector
 * that lists favorites at the top. Each row in the selector shows the model's
 * cost tier (free/low/mid/high/maxi) and per-1M-token input/output pricing
 * when the provider publishes them. The active model's tier is also kept
 * current in the footer status line via `ctx.ui.setStatus("tier", ...)`.
 *
 * Both features were previously split across two extensions; they were merged
 * here so a single selector is the entry point for picking, favoriting, and
 * judging cost tier at a glance.
 *
 * Storage:
 *   ~/.pi/agent/favorite-models.json
 *   { "version": 1, "favorites": ["provider/modelId", ...] }
 *   Order in the file is the order shown in the Favorites section.
 *
 * Usage:
 *   /fmodel               Open the favorites-first model selector
 *   Ctrl+Shift+L          Same selector
 *
 * In the selector (nav mode is the default):
 *   ↑/↓ or k/j           Move selection
 *   Space                Toggle favorite on the selected row
 *   Enter                Switch to the selected model
 *   /                    Enter search mode and filter the list
 *   Esc / Ctrl+C         Cancel
 *
 * In search mode (entered with /):
 *   Any character        Add to the filter (j/k type as literals, filter
 *                        also matches tier name like "high" or "free")
 *   Backspace            Remove the last filter char
 *   Enter                Switch to the selected model
 *   Esc                  Leave search mode (filter stays applied)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { modelsAreEqual } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	DynamicBorder,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	fuzzyFilter,
	Input,
	Key,
	matchesKey,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";

const STORAGE_FILENAME = "favorite-models.json";
const STORAGE_VERSION = 1;
const MAX_VISIBLE = 10;
const SHORTCUT = Key.ctrlShift("l");
const STATUS_KEY = "tier";

/** Cost tiers from cheapest to most expensive, plus `unknown` for gaps. */
type Tier = "free" | "low" | "mid" | "high" | "maxi" | "unknown";

/**
 * Hardcoded tier map for opencode-go models.
 *
 * Keys are bare `model.id`s (no provider prefix). If this extension is ever
 * extended to multiple providers, the key shape should become
 * `${provider}/${model.id}` or similar.
 */
const MODEL_TIERS: Record<string, Tier> = {
	"claude-haiku-5-5": "low",
	"deepseek-v4-flash": "low",
	"deepseek-v4-flash-vision-exp": "low",
	"deepseek-v4-pro": "mid",
	"deepseek-v4.1-flash": "low",
	"glm-5.2": "high",
	"glm-5.3": "high",
	"glm-5.3-flash": "low",
	"gpt-5.6-luna": "mid",
	"gpt-6-luna": "low",
	"grok-4.6": "high",
	"grok-4.7": "high",
	"hy3": "low",
	"hy4-preview": "mid",
	"kimi-k2.7-code": "mid",
	"kimi-k3": "maxi",
	"longcat-2.0": "mid",
	"longcat-2.5-preview-free": "free",
	"mimo-v2.5": "low",
	"mimo-v2.5-pro": "mid",
	"mimo-v2.6-flash": "low",
	"mimo-v2.6-pro": "mid",
	"minimax-m2.7": "mid",
	"minimax-m3": "mid",
	"muse-spark-1.2-contributor": "low",
	"muse-spark-1.3-contributor": "low",
	"qwen3.7-plus": "mid",
	"qwen3.8-flash": "low",
	"qwen3.8-max": "high",
	"space-bunny": "low",
	"step-5-preview-free": "free",
};

/** Classify a model into a cost tier by looking up its id in the tier map. */
function classify(model: Pick<Model<Api>, "id">): Tier {
	return MODEL_TIERS[model.id] ?? "unknown";
}

/**
 * Format a per-1M-token cost for display.
 *
 * Returns an empty string for zero, NaN, or undefined values so subscription
 * providers (which zero out costs at runtime) simply omit pricing.
 */
function formatCost(value: number | undefined): string {
	if (value === undefined || Number.isNaN(value) || value === 0) {
		return "";
	}
	if (value < 0) {
		console.warn(`[favorite-models] negative cost encountered: ${value}`);
		return "";
	}
	return `$${value.toFixed(2)}`;
}

interface StorageShape {
	version: number;
	favorites: string[];
}

function storageFilePath(): string {
	return join(getAgentDir(), STORAGE_FILENAME);
}

function loadFavorites(): string[] {
	const path = storageFilePath();
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<StorageShape>;
		if (!parsed || typeof parsed !== "object") return [];
		const list = Array.isArray(parsed.favorites) ? parsed.favorites : [];
		return list.filter((entry): entry is string => typeof entry === "string");
	} catch {
		return [];
	}
}

function saveFavorites(favorites: string[]): void {
	const dir = getAgentDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const payload: StorageShape = { version: STORAGE_VERSION, favorites };
	writeFileSync(storageFilePath(), JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

function modelKey(model: Model): string {
	return `${model.provider}/${model.id}`;
}

function isFavorite(favoriteSet: Set<string>, model: Model): boolean {
	return favoriteSet.has(modelKey(model));
}

function searchText(model: Pick<Model, "id" | "provider" | "name">): string {
	return `${model.id} ${model.provider} ${model.name} ${classify(model)}`;
}

/**
 * Build the model order shown in the selector.
 *   1. Favorites in stored order (only those still available)
 *   2. Current model (if not already a favorite)
 *   3. Remaining models, sorted by provider then id
 */
function buildDisplayModels(
	allModels: readonly Model[],
	favoriteSet: Set<string>,
	currentModel: Model | undefined,
	favoriteList: readonly string[],
): Model[] {
	const byKey = new Map<string, Model>();
	for (const model of allModels) byKey.set(modelKey(model), model);

	const ordered: Model[] = [];
	const seen = new Set<string>();

	for (const key of favoriteList) {
		const model = byKey.get(key);
		if (model && !seen.has(key)) {
			ordered.push(model);
			seen.add(key);
		}
	}

	if (currentModel && !seen.has(modelKey(currentModel))) {
		ordered.push(currentModel);
		seen.add(modelKey(currentModel));
	}

	const rest = allModels
		.filter((model) => !seen.has(modelKey(model)))
		.slice()
		.sort((a, b) => {
			const byProvider = a.provider.localeCompare(b.provider);
			return byProvider !== 0 ? byProvider : a.id.localeCompare(b.id);
		});

	ordered.push(...rest);
	return ordered;
}

function createSelector(
	tui: { requestRender: () => void },
	ctx: ExtensionContext,
	allModels: readonly Model[],
	favoriteList: string[],
	onResult: (result: { kind: "select"; model: Model } | { kind: "cancel" }) => void,
	onFavoriteChange: () => void,
): { render: (width: number) => string[]; invalidate: () => void; handleInput: (data: string) => void } {
	const currentModel = ctx.model;
	const favoriteSet = new Set(favoriteList);
	let displayModels: Model[] = buildDisplayModels(allModels, favoriteSet, currentModel, favoriteList);

	const container = new Container();
	container.addChild(new DynamicBorder());
	container.addChild(new Spacer(1));

	const header = new Text("", 0, 0);
	container.addChild(header);
	container.addChild(new Spacer(1));

	const searchInput = new Input({ placeholder: "Press / to filter" });
	searchInput.focused = false;
	container.addChild(searchInput);
	container.addChild(new Spacer(1));

	const listContainer = new Container();
	container.addChild(listContainer);
	container.addChild(new Spacer(1));

	const footer = new Text("", 0, 0);
	container.addChild(footer);
	container.addChild(new DynamicBorder());

	let selectedIndex = 0;
	let filteredModels: Model[] = displayModels;
	let searchMode = false;

	function rebuildDisplayModels(): void {
		displayModels = buildDisplayModels(allModels, favoriteSet, currentModel, favoriteList);
	}

	function applyHeader(): void {
		const favCount = favoriteList.length;
		const total = allModels.length;
		const label = favCount > 0 ? `${favCount} favorite${favCount === 1 ? "" : "s"}` : "no favorites yet";
		header.setText(`  Models: ${label} · ${total} total`);
	}

	function renderFooter(): void {
		if (searchMode) {
			footer.setText("  Esc exit filter · Enter select");
		} else {
			footer.setText("  ↑/↓ or k/j move · / filter · Space favorite · Enter select · Esc cancel");
		}
	}

	function setSearchMode(active: boolean): void {
		if (searchMode === active) {
			searchInput.focused = active;
			return;
		}
		searchMode = active;
		searchInput.focused = active;
		renderFooter();
	}

	function renderList(): void {
		listContainer.clear();

		if (filteredModels.length === 0) {
			listContainer.addChild(new Text("  No matching models", 0, 0));
			return;
		}

		const startIndex = Math.max(
			0,
			Math.min(selectedIndex - Math.floor(MAX_VISIBLE / 2), filteredModels.length - MAX_VISIBLE),
		);
		const endIndex = Math.min(startIndex + MAX_VISIBLE, filteredModels.length);

		let lastSection: "favorites" | "all" | null = null;

		for (let i = startIndex; i < endIndex; i++) {
			const model = filteredModels[i];
			if (!model) continue;

			const isFav = isFavorite(favoriteSet, model);
			const section: "favorites" | "all" = isFav ? "favorites" : "all";
			if (section !== lastSection) {
				if (lastSection !== null) listContainer.addChild(new Spacer(1));
				const label = section === "favorites" ? "  ── Favorites ──" : "  ── All models ──";
				listContainer.addChild(new Text(label, 0, 0));
				lastSection = section;
			}

			const isSelected = i === selectedIndex;
			const isCurrent = modelsAreEqual(currentModel, model);

			const cursor = isSelected ? "→ " : "  ";
			const favMark = isFav ? "★ " : "  ";
			const currentMark = isCurrent ? "✓ " : "  ";
			const tier = classify(model);
			const idText = isSelected ? `\x1b[36m${model.id}\x1b[0m` : model.id;
			const providerText = `[${model.provider}]`;
			const inputFormatted = formatCost(model.cost?.input);
			const outputFormatted = formatCost(model.cost?.output);
			const pricePart =
				inputFormatted || outputFormatted
					? ` · ${inputFormatted || "—"}/${outputFormatted || "—"}`
					: "";
			const tierText = `· ${tier}${pricePart}`;

			listContainer.addChild(
				new Text(`${cursor}${favMark}${currentMark}${idText} ${providerText} ${tierText}`, 0, 0),
			);
		}

		if (startIndex > 0 || endIndex < filteredModels.length) {
			listContainer.addChild(
				new Text(`  (${selectedIndex + 1}/${filteredModels.length})`, 0, 0),
			);
		}
	}

	function moveSelection(delta: number): void {
		if (filteredModels.length === 0) return;
		const next = selectedIndex + delta;
		if (next < 0) {
			selectedIndex = filteredModels.length - 1;
		} else if (next >= filteredModels.length) {
			selectedIndex = 0;
		} else {
			selectedIndex = next;
		}
		renderList();
	}

	function toggleFavorite(): void {
		const model = filteredModels[selectedIndex];
		if (!model) return;
		const key = modelKey(model);
		if (favoriteSet.has(key)) {
			favoriteSet.delete(key);
		} else {
			favoriteSet.add(key);
		}
		// Preserve the relative order of favorites that survived, append newcomers last.
		const previousOrder = new Map(favoriteList.map((entry, index) => [entry, index]));
		const nextList = Array.from(favoriteSet);
		nextList.sort((a, b) => {
			const ai = previousOrder.has(a) ? previousOrder.get(a)! : Number.MAX_SAFE_INTEGER;
			const bi = previousOrder.has(b) ? previousOrder.get(b)! : Number.MAX_SAFE_INTEGER;
			return ai - bi;
		});
		favoriteList.length = 0;
		favoriteList.push(...nextList);
		rebuildDisplayModels();
		filterModels(searchInput.getValue());
		// Keep the cursor on the same model after it (possibly) moved sections.
		selectedIndex = Math.max(0, filteredModels.findIndex((m) => modelKey(m) === key));
		applyHeader();
		renderList();
		onFavoriteChange();
	}

	function filterModels(query: string): void {
		if (!query) {
			filteredModels = displayModels;
		} else {
			filteredModels = fuzzyFilter(displayModels, query, searchText);
		}
		if (query) {
			selectedIndex = 0;
		} else {
			selectedIndex = Math.min(selectedIndex, Math.max(0, filteredModels.length - 1));
		}
		renderList();
	}

	searchInput.onSubmit = () => {
		const model = filteredModels[selectedIndex];
		if (model) onResult({ kind: "select", model });
	};

	applyHeader();
	renderFooter();
	filterModels("");

	function handleInput(data: string): void {
		// '/' enters search mode from nav mode. In search mode it is a literal
		// filter character and falls through to the input.
		if (data === "/") {
			if (!searchMode) {
				setSearchMode(true);
				tui.requestRender();
				return;
			}
			searchInput.handleInput(data);
			filterModels(searchInput.getValue());
			tui.requestRender();
			return;
		}

		if (searchMode) {
			if (matchesKey(data, Key.escape)) {
				setSearchMode(false);
				tui.requestRender();
				return;
			}
			if (data === "\x03" /* Ctrl+C */) {
				onResult({ kind: "cancel" });
				return;
			}
			// Enter is handled by the Input's onSubmit callback below; everything
			// else (chars, backspace, arrows for cursor positioning) goes to it.
			searchInput.handleInput(data);
			filterModels(searchInput.getValue());
			tui.requestRender();
			return;
		}

		// Nav mode: j/k and arrows move, space toggles favorite, '/' enters
		// search, enter selects, esc cancels. Other keys are ignored so the
		// user can safely type letters without accidentally filtering.
		if (matchesKey(data, Key.up) || data === "k") {
			moveSelection(-1);
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			moveSelection(1);
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.space)) {
			toggleFavorite();
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const model = filteredModels[selectedIndex];
			if (model) onResult({ kind: "select", model });
			return;
		}
		if (matchesKey(data, Key.escape) || data === "\x03" /* Ctrl+C */) {
			onResult({ kind: "cancel" });
			return;
		}
		// Ignore all other keys in nav mode.
	}

	return {
		render: (width: number) => container.render(width),
		invalidate: () => container.invalidate(),
		handleInput,
	};
}

async function openSelector(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	favoriteList: string[],
): Promise<Model | null> {
	const allModels = ctx.modelRegistry.getAvailable();
	if (allModels.length === 0) {
		ctx.ui.notify("No available models. Run /login first.", "warning");
		return null;
	}

	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: Model | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		void ctx.ui.custom<Model | null>((tui, _theme, _kb, done) => {
			return createSelector(
				tui,
				ctx,
				allModels,
				favoriteList,
				async (result) => {
					if (result.kind === "cancel") {
						done(null);
						finish(null);
						return;
					}
					const success = await pi.setModel(result.model);
					if (!success) {
						ctx.ui.notify(
							`Could not switch to ${modelKey(result.model)}: no credentials`,
							"error",
						);
						done(null);
						finish(null);
						return;
					}
					done(result.model);
					finish(result.model);
				},
				() => {
					try {
						saveFavorites(favoriteList);
					} catch (error) {
						ctx.ui.notify(`Failed to save ${STORAGE_FILENAME}: ${String(error)}`, "error");
					}
				},
			);
		});
	});
}

/** Footer status line for the current model: `tier:<tier> <id> · $in/$out`. */
function renderStatus(model: Pick<Model<Api>, "id" | "cost">): string {
	const tier = classify(model);
	const inputFormatted = formatCost(model.cost?.input);
	const outputFormatted = formatCost(model.cost?.output);

	if (inputFormatted || outputFormatted) {
		return `tier:${tier} ${model.id} · ${inputFormatted || "—"}/${outputFormatted || "—"}`;
	}
	return `tier:${tier} ${model.id}`;
}

function updateStatus(ctx: ExtensionContext): void {
	if (ctx.model) {
		ctx.ui.setStatus(STATUS_KEY, renderStatus(ctx.model));
	} else {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}
}

export default function favoriteModelsExtension(pi: ExtensionAPI) {
	let favoriteList: string[] = [];

	pi.on("session_start", (_event, ctx) => {
		favoriteList = loadFavorites();
		updateStatus(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		updateStatus(ctx);
	});

	async function runSelector(ctx: ExtensionContext): Promise<void> {
		const picked = await openSelector(pi, ctx, favoriteList);
		if (picked) ctx.ui.notify(`Switched to ${modelKey(picked)}.`, "info");
	}

	pi.registerCommand("fmodel", {
		description: "Pick a model with favorites and cost tiers shown",
		handler: async (_args, ctx) => {
			await runSelector(ctx);
		},
	});

	pi.registerShortcut(SHORTCUT, {
		description: "Open favorites-first model selector",
		handler: async (ctx) => {
			await runSelector(ctx);
		},
	});

	pi.on("session_shutdown", () => {
		try {
			saveFavorites(favoriteList);
		} catch (error) {
			console.error(`Failed to save ${STORAGE_FILENAME}:`, error);
		}
	});
}
