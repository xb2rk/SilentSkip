# FC fixtures

Hand-written synthetic `.fcc`/`.fcg` samples used by the vendored toolchain gate
(`test/formatter-fixtures.test.ts`) and, via that package, by the engine's fact/relation gates.
They are authored in-repo: no source files from any real project are checked in.

They intentionally cover a representative mix of constructs — imports, enums, tuples, graph
declarations, platform annotations, functions, `if`/`for`/`break`, value initializers, string
literals and guard comparisons — so the gate is meaningful while staying small and stable.
