/** The pendant advertises itself under its old name ("Mind-Pendant"); the app calls it wali. */
export const pendantName = (name?: string | null) => (!name || name === "?" || /^mind\b/i.test(name) ? "wali pendant" : name);
