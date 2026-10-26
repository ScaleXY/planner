/** An error whose message is shown to the user as-is, without a stack trace. */
export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode = 1,
	) {
		super(message);
	}
}
