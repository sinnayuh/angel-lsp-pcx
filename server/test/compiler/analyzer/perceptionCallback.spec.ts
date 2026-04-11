import {expectError, expectSuccess} from "./utils";

// Simulate the Perception predefined just for these tests.
const prelude = `
    funcdef void __Internal_CallbackFn(int callback_id, int data_index);
    int register_callback(__Internal_CallbackFn@ fn, int every_ms, int data_index) { return 0; }
    void unregister_callback(int id) { }
`;

describe('analyzer/perceptionCallback', () => {
    // Valid callback signature.
    expectSuccess(prelude + `
        void my_callback(int callback_id, int data_index) { }
        int main() {
            register_callback(@my_callback, 16, 0);
            return 1;
        }
    `);

    // Wrong: takes no parameters.
    expectError(prelude + `
        void my_callback() { }
        int main() {
            register_callback(@my_callback, 16, 0);
            return 1;
        }
    `);

    // Wrong: takes one parameter.
    expectError(prelude + `
        void my_callback(int callback_id) { }
        int main() {
            register_callback(@my_callback, 16, 0);
            return 1;
        }
    `);

    // Wrong: parameter is a string instead of int.
    expectError(prelude + `
        void my_callback(string a, int b) { }
        int main() {
            register_callback(@my_callback, 16, 0);
            return 1;
        }
    `);

    // Wrong: returns int instead of void.
    expectError(prelude + `
        int my_callback(int a, int b) { return 0; }
        int main() {
            register_callback(@my_callback, 16, 0);
            return 1;
        }
    `);
});
