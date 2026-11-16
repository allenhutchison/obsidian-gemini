/**
 * Exhaustiveness check for a `switch` over a union (#1757).
 *
 * Put it in the `default` arm: when every member of the union has a `case`,
 * the value narrows to `never` and this compiles. When the union grows a
 * member with no `case`, the call stops compiling, so a new provider (or any
 * other new union member) can't fall through to whatever the last arm does.
 * The throw only runs if a value outside the type reaches it at runtime, for
 * example from a hand-edited settings file.
 */
export function assertNever(value: never, context: string): never {
	throw new Error(`${context}: unhandled value ${JSON.stringify(value)}`);
}
