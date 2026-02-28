// Disable the built-in Perception predefined during server tests so the
// Perception API symbols don't appear in completion/analyzer test assertions.
process.env.ANGEL_LSP_TEST = '1';
