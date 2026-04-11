import {expectError, expectSuccess} from "./utils";

describe('analyzer/handleOnNonReference', () => {
    // Reference type: `@` is valid.
    expectSuccess(`
        class CPlayer { int hp; }
        void main() {
            CPlayer@ p = CPlayer();
            if (p is null) return;
        }
    `);

    // Perception value type: `@` must error.
    expectError(`
        class proc_t { uint64 base_address() const; }
        void ReadXformCols(proc_t@ proc, uint64 addr) { }
    `);

    // Another Perception value type: mutex_t as a variable declared with `@`.
    expectError(`
        class mutex_t { void lock(); }
        void main() {
            mutex_t@ m;
        }
    `);

    // Value type in a return position.
    expectError(`
        class vector3 { float x; float y; float z; }
        vector3@ make() { return vector3(); }
    `);

    // Primitive types cannot be handles.
    expectError(`
        void main() {
            int@ x;
        }
    `);

    // Enum types cannot be handles.
    expectError(`
        enum Mode { A, B }
        void main() {
            Mode@ m;
        }
    `);
});
