export type ValidationResult<T> = { valid: true; data: T } | { valid: false; error: string };
