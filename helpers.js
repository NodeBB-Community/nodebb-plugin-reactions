'use strict';

let emojiTable = null;
let emojiAliases = null;
let characterIndex = null;

function getEmojiTable() {
	if (!emojiTable) {
		emojiTable = nodebb.require('nodebb-plugin-emoji/build/emoji/table.json');
	}
	return emojiTable;
}

function getEmojiAliases() {
	if (!emojiAliases) {
		emojiAliases = nodebb.require('nodebb-plugin-emoji/build/emoji/aliases.json');
	}
	return emojiAliases;
}

function getCharacterIndex() {
	if (!characterIndex) {
		characterIndex = new Map();
		Object.keys(getEmojiTable()).forEach((name) => {
			const entry = getEmojiTable()[name];
			if (entry && entry.character && !characterIndex.has(entry.character)) {
				characterIndex.set(entry.character, name);
			}
		});
	}
	return characterIndex;
}

function resolveByName(name) {
	if (!name || typeof name !== 'string') {
		return null;
	}
	name = name.trim();
	if (getEmojiTable()[name]) {
		return name;
	}
	const aliases = getEmojiAliases();
	if (aliases[name] && getEmojiTable()[aliases[name]]) {
		return aliases[name];
	}
	return null;
}

/**
 * Resolve FEP-c0e0 reaction content (unicode grapheme, `:shortcode:`, bare name,
 * or a custom-emoji `tag`) to a local emoji name. Returns null when unresolvable.
 */
function resolveReaction(content, tag) {
	if (typeof content !== 'string' || !content.trim()) {
		return null;
	}
	const trimmed = content.trim();

	let reaction;

	// `:shortcode:`
	const shortcode = trimmed.match(/^:([a-z0-9_+-]+):$/i);
	if (shortcode) {
		reaction = resolveByName(shortcode[1]);
	} else {
		// Bare name (only accepted when it resolves to a local emoji)
		reaction = resolveByName(trimmed);

		if (!reaction) {
			// Unicode grapheme
			const index = getCharacterIndex();
			if (index.has(trimmed)) {
				reaction = index.get(trimmed);
			}
			// Retry without variation selectors (table entries may omit them, e.g. keycaps)
			const noVariation = trimmed.replace(/\uFE0F/g, '');
			if (!reaction && noVariation !== trimmed && index.has(noVariation)) {
				reaction = index.get(noVariation);
			}
			const firstCodepoint = [...trimmed][0];
			if (!reaction && firstCodepoint && index.has(firstCodepoint)) {
				reaction = index.get(firstCodepoint);
			}
		}
	}

	// Custom emoji: the tag carries the emoji's identity, so it is consulted
	// when the content alone does not resolve to a local emoji (a remote
	// custom emoji whose name matches a built-in one is usable)
	if (!reaction && Array.isArray(tag)) {
		const emojiTag = tag.find(t => t && t.type === 'Emoji' && typeof t.name === 'string');
		if (emojiTag) {
			reaction = resolveByName(emojiTag.name.replace(/^:|:$/g, ''));
		}
	}

	return reaction;
}

module.exports = {
	getEmojiTable,
	getEmojiAliases,
	getCharacterIndex,
	resolveByName,
	resolveReaction,
};
