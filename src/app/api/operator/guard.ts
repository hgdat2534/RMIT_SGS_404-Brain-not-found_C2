// The operator console stands in for "whoever runs the server" — it is the threat, not a user.
// It is on for local demos; set ERRAND_OPERATOR_CONSOLE=off to remove it.
export const operatorEnabled = () => process.env.ERRAND_OPERATOR_CONSOLE !== "off";
