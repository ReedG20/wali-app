import { ActionSheetIOS, Alert } from "react-native";
import { personChoices, typedName, type KnownPerson, type Target } from "../lib/voices";

export type PickResult<E extends string> = { target: Target } | { extra: E } | null;

/**
 * "Who's this?" as a native action sheet: "That's me", everyone wali already knows, "New name…"
 * (a text prompt), any extra actions the caller adds, and a way out that leaves the voice as it
 * is. Resolves with what was picked, or null.
 */
export function pickPerson<E extends string = never>(opts: {
  title: string;
  message?: string;
  people: KnownPerson[];
  currentPersonId?: string | null;
  allowMe?: boolean;
  /** Prefilled in the "New name…" prompt. */
  suggestion?: string | null;
  extras?: { key: E; label: string; destructive?: boolean }[];
  cancelLabel?: string;
}): Promise<PickResult<E>> {
  const choices = personChoices(opts.people, { currentPersonId: opts.currentPersonId, allowMe: opts.allowMe });
  const extras = opts.extras ?? [];
  const newIndex = choices.length;
  const options = [...choices.map((c) => c.label), "New name…", ...extras.map((x) => x.label), opts.cancelLabel ?? "Cancel"];
  const cancelButtonIndex = options.length - 1;
  const destructive = extras.flatMap((x, i) => (x.destructive ? [newIndex + 1 + i] : []));

  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: opts.title, message: opts.message, options, cancelButtonIndex, destructiveButtonIndex: destructive },
      (i) => {
        if (i < newIndex) return resolve({ target: choices[i].target });
        if (i === newIndex) return void promptName(opts.title, opts.suggestion).then((name) => resolve(name ? { target: { name } } : null));
        if (i < cancelButtonIndex) return resolve({ extra: extras[i - newIndex - 1].key });
        resolve(null);
      },
    );
  });
}

/** A text prompt for a name. Resolves with the cleaned name, or null if cancelled or left blank. */
export function promptName(title: string, defaultValue?: string | null, message = "Their name, or Mom, Dad…", save = "Save"): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.prompt(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        { text: save, isPreferred: true, onPress: (text?: string) => resolve(typedName(text)) },
      ],
      "plain-text",
      defaultValue ?? "",
      "default",
    );
  });
}
