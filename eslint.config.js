import tseslint from 'typescript-eslint'

/**
 * Determinism guards for `packages/sim`.
 *
 * Premise 3 of the design doc: two machines run this simulation in parallel and
 * must stay bit-identical forever. IEEE 754 pins `+ - * / sqrt` to exact
 * results on every engine; the transcendentals do not, because each platform
 * ships its own libm and they differ in the last bits.
 *
 * These rules make a violation unlikely. They are NOT the guarantee — the
 * cross-engine golden fixture is (packages/sim/test/golden.test.ts, run under
 * both V8 and a non-V8 engine in CI). A lint rule cannot see everything:
 * `no-restricted-properties` matches property access, so an alias defeats it,
 * which is why `no-restricted-globals` bans the `Math` identifier outright and
 * every allowed call has to be written as a literal `Math.foo(...)`.
 *
 * Ordering, not arithmetic, is now the likelier source of divergence: unordered
 * iteration and comparator-less sorts are banned here for the same reason.
 */

const ALLOWED_MATH = [
  'abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc', 'sign', 'sqrt',
  // Integer multiply. Fully specified by ECMAScript, unlike the libm calls this
  // list exists to keep out. Used by the FNV hash and the seeded PRNG.
  'imul',
]

const BANNED_MATH = [
  'random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'pow', 'exp', 'log', 'log2', 'log10', 'sinh', 'cosh', 'tanh',
  'hypot', 'cbrt', 'expm1', 'log1p', 'fround',
]

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  {
    files: ['packages/sim/src/**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      'no-restricted-properties': [
        'error',
        ...BANNED_MATH.map((m) => ({
          object: 'Math',
          property: m,
          message: `Math.${m} is not bit-exact across engines. Allowed: ${ALLOWED_MATH.join(', ')}.`,
        })),
        {
          object: 'Date',
          property: 'now',
          message: 'The sim reads no clock. The driver owns the accumulator and passes ticks in.',
        },
        {
          object: 'Object',
          property: 'keys',
          message: 'Unordered iteration. Use an array or a typed array with an explicit order.',
        },
        {
          object: 'Object',
          property: 'values',
          message: 'Unordered iteration. Use an array or a typed array with an explicit order.',
        },
        {
          object: 'Object',
          property: 'entries',
          message: 'Unordered iteration. Use an array or a typed array with an explicit order.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message: 'for...in order is not guaranteed. Use an indexed loop.',
        },
        {
          selector: "BinaryExpression[operator='**']",
          message: 'The ** operator is Math.pow spelled differently, and is banned for the same reason.',
        },
        {
          selector: "CallExpression[callee.property.name='sort'][arguments.length=0]",
          message: 'Array.sort without a comparator coerces to string. Pass an explicit comparator.',
        },
        {
          // Closes the alias hole. `no-restricted-properties` only sees member
          // expressions, so `const m = Math; m.sin(x)` and `const {sin} = Math`
          // both slip past it. Banning `Math` outright is not an option — the
          // allowlisted calls need it — so ban binding it to a name instead.
          selector: "VariableDeclarator[init.name='Math']",
          message:
            'Do not alias or destructure Math. Write Math.foo(...) literally so the property ban can see it.',
        },
        {
          selector: "AssignmentExpression[right.name='Math']",
          message:
            'Do not alias Math. Write Math.foo(...) literally so the property ban can see it.',
        },
        {
          selector: "TSEnumDeclaration[const=true]",
          message:
            'const enum cannot be inlined by esbuild, so it breaks under Vite and Vitest, and isolatedModules makes ambient references an error. Use a plain enum.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
