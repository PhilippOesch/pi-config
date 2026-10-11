/**
 * Favorite Models Extension
 *
 * Mark often-used models as favorites and pick them from a dedicated selector
 * that lists favorites at the top. Built on top of the same model snapshot
 * the built-in /model selector uses.
 *
 * Storage:
 *   ~/.pi/agent/favorite-models.json
 *   { "version": 1, "favorites": ["provider/modelId", ...] }
 *   Order in the file is the order shown in the Favorites section.
 *
 * Usage:
 *   /fmodel               Open the favorites-first model selector
 *   Ctrl+Shift+M          Same selector
 *
 * In the selector:
 *   ↑/↓ or k/j           Move selection
 *   Enter                Switch to the selected model
 *   Space                Toggle favorite on the selected row
 *   Esc / Ctrl+C         Cancel
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
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
	Spacer,
	Text,
} from "@earendil-works/pi-tui";

const STORAGE_FILENAME = "favorite-models.json";
const STORAGE_VERSION = 1;
const MAX_VISIBLE = 10;
const SHORTCUT = Key.ctrlShift("m");

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

function searchText(model: Model): string {
	return `${model.id} ${model.provider} ${model.name}`;
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

	const searchInput = new Input({ placeholder: "Type to filter, space to favorite" });
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
		footer.setText("  ↑/↓ move · Enter select · Space favorite · Esc cancel");
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
			const idText = isSelected ? `\x1b[36m${model.id}\x1b[0m` : model.id;
			const providerText = `[${model.provider}]`;

			listContainer.addChild(new Text(`${cursor}${favMark}${currentMark}${idText} ${providerText}`, 0, 0));
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
		if (data === Key.up || data === "k") {
			moveSelection(-1);
			tui.requestRender();
			return;
		}
		if (data === Key.down || data === "j") {
			moveSelection(1);
			tui.requestRender();
			return;
		}
		if (data === Key.space) {
			toggleFavorite();
			tui.requestRender();
			return;
		}
		if (data === Key.escape || data === "\x03" /* Ctrl+C */) {
			onResult({ kind: "cancel" });
			return;
		}
		searchInput.handleInput(data);
		filterModels(searchInput.getValue());
		tui.requestRender();
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

export default function favoriteModelsExtension(pi: ExtensionAPI) {
	let favoriteList: string[] = [];

	pi.on("session_start", async () => {
		favoriteList = loadFavorites();
	});

	async function runSelector(ctx: ExtensionContext): Promise<void> {
		const picked = await openSelector(pi, ctx, favoriteList);
		if (picked) ctx.ui.notify(`Switched to ${modelKey(picked)}.`, "info");
	}

	pi.registerCommand("fmodel", {
		description: "Pick a model with favorites listed first",
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
