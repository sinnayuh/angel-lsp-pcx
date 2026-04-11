// Types registered by the Perception engine via C++ as asOBJ_VALUE.
// The AngelScript engine rejects object handles (`@`) on these with the
// runtime error "Object handle is not supported for this type".
// Keep this in sync with perception.as.predefined.
const perceptionValueTypeNames: ReadonlyArray<string> = [
    // Process API
    "proc_t",

    // Threading
    "mutex_t",
    "atomic_int8",
    "atomic_int16",
    "atomic_int32",
    "atomic_int64",
    "atomic_uint8",
    "atomic_uint16",
    "atomic_uint32",
    "atomic_uint64",

    // Extended math
    "vector2",
    "vector3",
    "vector4",
    "quaternion",
    "matrix4x4",

    // Net
    "ws_t",

    // Zydis
    "zydis_request_t",
    "zydis_builder_t",
    "zydis_decoded_t",

    // Unicorn
    "uc_engine_t",
    "uc_context_t",
    "uc_hook_t",
];

const perceptionValueTypeSet = new Set<string>(perceptionValueTypeNames);

export function isPerceptionValueType(name: string): boolean {
    return perceptionValueTypeSet.has(name);
}
