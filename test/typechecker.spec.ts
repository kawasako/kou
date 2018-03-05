import chalk from 'chalk';
import * as a from '../src/parser/ast';
import { tokenize } from '../src/lexer/';
import { parse } from '../src/parser/';
import { desugarBefore } from '../src/desugarer/';
import { Compose } from '../src/util';
import {
  checkExprType,
  checkBlockType,
  typeEqual,
  typeCheck,
} from '../src/typechecker/';
import { TypeContext } from '../src/typechecker/context';
import { TypeError } from '../src/typechecker/error';

console.log(chalk.bold('Running typechecker tests...'));

// simple type instances
const intType = new a.IntType(-1, -1);
const floatType = new a.FloatType(-1, -1);
const charType = new a.CharType(-1, -1);
const strType = new a.StrType(-1, -1);
const boolType = new a.BoolType(-1, -1);
const voidType = new a.VoidType(-1, -1);

// complex type constructors
const tupleType = (v: a.Tuple<a.Type<any>>) => new a.TupleType(v, -1, -1);
const listType = (v: a.Type<any>) => new a.ListType(v, -1, -1);
const funcType = (v: { param: a.Type<any>; return: a.Type<any> }) =>
  new a.FuncType(v, -1, -1);

const compileAST = Compose.then(tokenize)
  .then(parse)
  .then(desugarBefore).f;

function exprTypeTest(
  exprStr: string,
  ctx: TypeContext,
  expectedType: a.Type<any>,
  shouldThrow?: string,
) {
  const moduleStr = `let x = ${exprStr}`;

  function failWith(errMsg: string) {
    console.error(chalk.blue.bold('Test:'));
    console.error(exprStr);
    console.error();
    console.error(chalk.red.bold('Error:'));
    console.error(errMsg);
    process.exit(1);
  }

  try {
    const mod = compileAST(moduleStr);
    const actualType = checkExprType(mod.value.decls[0].value.expr, ctx);
    typeEqual(actualType, expectedType);
  } catch (err) {
    if (
      shouldThrow &&
      err instanceof TypeError &&
      err.message.includes(shouldThrow)
    ) {
      return;
    }

    failWith(err);
  }

  if (shouldThrow) {
    failWith(`No error was thrown for '${shouldThrow}'`);
  }
}

function blockTypeTest(
  blockStr: string,
  ctx: TypeContext,
  expectedType: a.Type<any>,
) {
  const moduleStr = `let x = fn () ${expectedType.name} ${blockStr}`;
  try {
    const mod = compileAST(moduleStr);
    const fn = mod.value.decls[0].value.expr as a.FuncExpr;
    const actualType = checkBlockType(fn.value.body, ctx);
    typeEqual(actualType, expectedType);
  } catch (err) {
    console.error(chalk.blue.bold('Test:'));
    console.error(blockStr);
    console.error();
    console.error(chalk.red.bold('Error:'));
    console.error(err);
    process.exit(1);
  }
}

function ctx(obj: Array<{ [name: string]: a.Type<any> }> = []): TypeContext {
  const ctx = new TypeContext();
  for (const scopeObj of obj) {
    Object.keys(scopeObj).forEach(name =>
      ctx.push({ ident: new a.Ident(name, -1, -1), type: scopeObj[name] }),
    );
  }
  return ctx;
}

// literal
exprTypeTest('123', ctx(), new a.IntType(0, 0));
exprTypeTest('.123', ctx(), new a.FloatType(0, 0));
exprTypeTest('"hello, world"', ctx(), new a.StrType(0, 0));
exprTypeTest('true', ctx(), new a.BoolType(0, 0));
exprTypeTest('false', ctx(), new a.BoolType(0, 0));
exprTypeTest("'\\n'", ctx(), new a.CharType(0, 0));

// ident
exprTypeTest('some_ident', ctx([{ some_ident: intType }]), intType);
exprTypeTest(
  'some_ident',
  ctx([{}, { other_ident: floatType }, { some_ident: intType }, {}]),
  intType,
);
exprTypeTest(
  'some_ident',
  ctx([{}, { one_ident: intType }, { some_ident: strType }, {}]),
  strType,
);
exprTypeTest(
  'invalid_ident',
  ctx([{}, { one_ident: intType }, { some_ident: strType }, {}]),
  strType,
  'undefined identifier: found invalid_ident',
);

// tuple
exprTypeTest(
  '(123, hello, true)',
  ctx([{ hello: strType }]),
  tupleType({
    size: 3,
    items: [intType, strType, boolType],
  }),
);
exprTypeTest(
  '(123, hello, false)',
  ctx([{ hello: strType }]),
  tupleType({
    size: 4,
    items: [intType, strType, boolType, charType],
  }),
  'Tuple length mismatch: expected (int, str, bool, char), found (int, str, bool)',
);
exprTypeTest(
  '(1234, hello, true)',
  ctx([{ hello: strType }]),
  tupleType({
    size: 3,
    items: [intType, charType, boolType],
  }),
  'Type mismatch: expected (int, char, bool), found (int, str, bool)',
);

// list
exprTypeTest('[1, 2, 3, 4]', ctx(), listType(intType));
exprTypeTest('[]', ctx(), listType(intType));
exprTypeTest('[]', ctx(), listType(strType));
exprTypeTest('[[1], [2, 3, 4], []]', ctx(), listType(listType(intType)));
exprTypeTest(
  '[some_ident, 4]',
  ctx([{ some_ident: intType }]),
  listType(intType),
);
exprTypeTest(
  '[some_ident, 4]',
  ctx([{ some_ident: intType }]),
  listType(strType),
  'Type mismatch: expected [str], found [int]',
);
exprTypeTest(
  '[some_ident, "str", 4]',
  ctx([{ some_ident: intType }]),
  listType(intType),
  'Type mismatch: expected int, found str',
);

// function
exprTypeTest(
  'fn (a int) bool { true }',
  ctx(),
  funcType({
    param: intType,
    return: boolType,
  }),
);
exprTypeTest(
  'fn (a int, b str) bool { true }',
  ctx(),
  funcType({
    param: tupleType({
      size: 2,
      items: [intType, strType],
    }),
    return: boolType,
  }),
);
exprTypeTest(
  "fn (a int, b str) bool -> char { fn (c bool) char { 'a' } }",
  ctx(),
  funcType({
    param: tupleType({
      size: 2,
      items: [intType, strType],
    }),
    return: funcType({
      param: boolType,
      return: charType,
    }),
  }),
);
exprTypeTest(
  "fn (a str -> int) bool -> char { fn (c bool) char { 'a' } }",
  ctx(),
  funcType({
    param: funcType({
      param: strType,
      return: intType,
    }),
    return: funcType({
      param: boolType,
      return: charType,
    }),
  }),
);
exprTypeTest(
  "fn (a float, b str -> int) bool -> char { fn (c bool) char { 'a' } }",
  ctx(),
  funcType({
    param: tupleType({
      size: 2,
      items: [
        floatType,
        funcType({
          param: strType,
          return: intType,
        }),
      ],
    }),
    return: funcType({
      param: boolType,
      return: charType,
    }),
  }),
);
exprTypeTest(
  'fn (a int, b str) bool { false }',
  ctx(),
  funcType({
    param: tupleType({
      size: 2,
      items: [charType, strType],
    }),
    return: boolType,
  }),
  'Type mismatch: expected (char, str) -> bool, found (int, str) -> bool',
);
exprTypeTest(
  "fn (a int, b str) bool -> char { fn (c bool) char { 'a' } }",
  ctx(),
  funcType({
    param: tupleType({
      size: 2,
      items: [intType, strType],
    }),
    return: funcType({
      param: boolType,
      return: boolType,
    }),
  }),
  'Type mismatch: expected (int, str) -> bool -> bool, found (int, str) -> bool -> char',
);
exprTypeTest(
  "fn (a str -> int) bool -> char { fn (c bool) char { 'a' } }",
  ctx(),
  funcType({
    param: funcType({
      param: strType,
      return: boolType,
    }),
    return: funcType({
      param: boolType,
      return: charType,
    }),
  }),
  'Type mismatch: expected (str -> bool) -> bool -> char, found (str -> int) -> bool -> char',
);
exprTypeTest(
  'fn (a int) bool {}',
  ctx(),
  funcType({
    param: intType,
    return: boolType,
  }),
  'Function return type mismatch: expected bool, found void',
);
exprTypeTest(
  'fn (a int) bool { a }',
  ctx(),
  funcType({
    param: intType,
    return: boolType,
  }),
  'Function return type mismatch: expected bool, found int',
);
exprTypeTest(
  'fn (a int) void { a }',
  ctx(),
  funcType({
    param: intType,
    return: voidType,
  }),
  "Function return type mismatch, ';' may be missing: expected void, found int",
);
exprTypeTest(
  'fn (a int) void { a; }',
  ctx(),
  funcType({
    param: intType,
    return: voidType,
  }),
);

// call expr
exprTypeTest('fn (a int, b int) int { a } (1, 2)', ctx(), intType);
exprTypeTest('fn (a str) char { \'a\' } ("hello")', ctx(), charType);
exprTypeTest(
  "fn (a str -> int) bool -> char { fn (c bool) char { 'a' } } (fn (a str) int { 1 })",
  ctx(),
  funcType({
    param: boolType,
    return: charType,
  }),
);
exprTypeTest(
  'f1(f2)',
  ctx([
    {
      f1: funcType({
        param: funcType({
          param: strType,
          return: boolType,
        }),
        return: funcType({
          param: boolType,
          return: charType,
        }),
      }),
      f2: funcType({
        param: strType,
        return: boolType,
      }),
    },
  ]),
  funcType({
    param: boolType,
    return: charType,
  }),
);
exprTypeTest(
  '"i am not callable"(1, \'c\')',
  ctx(),
  voidType,
  'non-callable target: expected function, found str',
);
exprTypeTest(
  "fn (a int, b int) int { a } (1, 'c')",
  ctx(),
  intType,
  'Function parameter type mismatch: expected (int, int), found (int, char)',
);
exprTypeTest(
  "fn (a str) char { 'a' } (.123)",
  ctx(),
  charType,
  'Function parameter type mismatch: expected str, found float',
);

// block
blockTypeTest('{}', ctx(), voidType);
blockTypeTest(
  `
{
  let x = fn () int { x() };
  x()
}
`,
  ctx(),
  intType,
);
blockTypeTest(
  `
{
  f(123);
  let y = f(g);
  h(y)
}
`,
  ctx([
    {
      f: funcType({
        param: intType,
        return: boolType,
      }),
    },
    { g: intType },
    {
      h: funcType({
        param: boolType,
        return: charType,
      }),
    },
  ]),
  charType,
);
blockTypeTest(
  `
{
  f(123);
  let y = f(g);
  h(y);
}
`,
  ctx([
    {
      f: funcType({
        param: intType,
        return: boolType,
      }),
    },
    { g: intType },
    {
      h: funcType({
        param: boolType,
        return: charType,
      }),
    },
  ]),
  voidType,
);

// index expr
exprTypeTest('list[3]', ctx([{ list: listType(intType) }]), intType);
exprTypeTest('"hello"[3]', ctx(), charType);
exprTypeTest('("hello", false, 123)[0]', ctx(), strType);
exprTypeTest('("hello", false, 123)[1]', ctx(), boolType);
exprTypeTest('("hello", false, 123)[2]', ctx(), intType);
exprTypeTest(
  '("hello", false, 123)[3]',
  ctx(),
  voidType,
  'Tuple index out of range: expected int < 3, found 3',
);
exprTypeTest(
  'list[no_int]',
  ctx([
    {
      list: listType(intType),
      no_int: charType,
    },
  ]),
  intType,
  'Index type mismatch: expected int, found char',
);
exprTypeTest(
  '"hello"[no_int]',
  ctx([{ no_int: charType }]),
  charType,
  'Index type mismatch: expected int, found char',
);
exprTypeTest(
  '("hello", false, 123)[i]',
  ctx([{ i: intType }]),
  voidType,
  'Invalid tuple index: only int literal is allowed for tuple index: found expr',
);
exprTypeTest(
  '("hello", false, 123)[no_int]',
  ctx([{ no_int: charType }]),
  voidType,
  'Invalid tuple index: only int literal is allowed for tuple index: found expr',
);
exprTypeTest(
  '3[0]',
  ctx(),
  voidType,
  'Indexable type mismatch: expected list, str or tuple, found int',
);

// cond expr
exprTypeTest(
  'if some_bool { 10 } else { 20 }',
  ctx([{ some_bool: boolType }]),
  intType,
);
exprTypeTest(
  'if f(123) { "hello" } else { "world" }',
  ctx([
    {
      f: funcType({ param: intType, return: boolType }),
    },
  ]),
  strType,
);
exprTypeTest(
  'if some_char { 10 } else { 20 }',
  ctx([{ some_char: charType }]),
  intType,
  'Type mismatch: expected bool, found char',
);
exprTypeTest(
  'if some_bool { 10 } else { "hello" }',
  ctx([{ some_bool: boolType }]),
  intType,
  "'else' block should have the same type as 'if' block: expected int, found str",
);
exprTypeTest(
  'if some_bool { } else { "hello" }',
  ctx([{ some_bool: boolType }]),
  voidType,
  "'else' block should have the same type as 'if' block, ';' may be missing: expected void, found str",
);
exprTypeTest(
  'if some_bool { } else { "hello"; }',
  ctx([{ some_bool: boolType }]),
  voidType,
);

// loop expr
exprTypeTest(
  'for x in [1, 2, 3] { f(x) }',
  ctx([
    {
      f: funcType({ param: intType, return: boolType }),
    },
  ]),
  listType(boolType),
);
exprTypeTest(
  'for x in [1, 2, 3] { f(x); }',
  ctx([
    {
      f: funcType({ param: intType, return: boolType }),
    },
  ]),
  listType(voidType),
);
exprTypeTest(
  'for x in [1, 2, 3] { f(x) }',
  ctx([
    {
      f: funcType({ param: charType, return: boolType }),
    },
  ]),
  listType(boolType),
  'Function parameter type mismatch: expected char, found int',
);
exprTypeTest(
  'for x in 123 { f(x) }',
  ctx([
    {
      f: funcType({ param: intType, return: boolType }),
    },
  ]),
  listType(boolType),
  'Loop target should be a list: found int',
);

// unary expr
exprTypeTest(
  '+x',
  ctx([
    {
      x: intType,
    },
  ]),
  intType,
);
exprTypeTest(
  '-x',
  ctx([
    {
      x: intType,
    },
  ]),
  intType,
);
exprTypeTest(
  '+x',
  ctx([
    {
      x: floatType,
    },
  ]),
  floatType,
);
exprTypeTest(
  '-x',
  ctx([
    {
      x: floatType,
    },
  ]),
  floatType,
);
exprTypeTest(
  '!x',
  ctx([
    {
      x: boolType,
    },
  ]),
  boolType,
);
exprTypeTest(
  '-x',
  ctx([
    {
      x: boolType,
    },
  ]),
  boolType,
  "Operand type mismatch for '-': expected int or float, found bool",
);
exprTypeTest(
  '!x',
  ctx([
    {
      x: intType,
    },
  ]),
  intType,
  "Operand type mismatch for '!': expected bool, found int",
);

// binary expr
// eq op
exprTypeTest('1 == 1', ctx(), boolType);
exprTypeTest('"hello" != "hello"', ctx(), boolType);
exprTypeTest(
  '"hello" == 3',
  ctx(),
  boolType,
  "Right-hand operand type mismatch for '==': expected str, found int",
);
// comp op
exprTypeTest('3.5 > .0', ctx(), boolType);
exprTypeTest("'c' > 'a'", ctx(), boolType);
exprTypeTest(
  "'c' < 3",
  ctx(),
  boolType,
  "Right-hand operand type mismatch for '<': expected char, found int",
);
exprTypeTest(
  'fn () void {} <= 3',
  ctx(),
  boolType,
  "Left-hand operand type mismatch for '<=': expected int, float, bool, char or str, found () -> void",
);
// add & mul op
exprTypeTest('3 + 0', ctx(), intType);
exprTypeTest('3 * 123 / 13', ctx(), intType);
exprTypeTest('3.5 + .0', ctx(), floatType);
exprTypeTest('3.5 * .0 / 1.0', ctx(), floatType);
exprTypeTest(
  '3.5 * 1 / 1.0',
  ctx(),
  floatType,
  "Right-hand operand type mismatch for '*': expected float, found int",
);
exprTypeTest(
  '"4" | 1',
  ctx(),
  intType,
  "Left-hand operand type mismatch for '|': expected int or float, found str",
);
// bool op
exprTypeTest('true && false', ctx(), boolType);
exprTypeTest('true || false', ctx(), boolType);
exprTypeTest(
  '.1 || false',
  ctx(),
  boolType,
  "Left-hand operand type mismatch for '||': expected bool, found float",
);
exprTypeTest(
  'true && 1',
  ctx(),
  boolType,
  "Right-hand operand type mismatch for '&&': expected bool, found int",
);

function typeCheckTest(
  program: string,
  context: TypeContext,
  shouldThrow?: string,
) {
  function failWith(errMsg: string) {
    console.error(chalk.blue.bold('Test:'));
    console.error(program);
    console.error();
    console.error(chalk.red.bold('Error:'));
    console.error(errMsg);
    process.exit(1);
  }

  try {
    typeCheck(compileAST(program), context);
  } catch (err) {
    if (
      shouldThrow &&
      err instanceof TypeError &&
      err.message.includes(shouldThrow)
    ) {
      return;
    }

    failWith(err);
  }

  if (shouldThrow) {
    failWith(`No error was thrown for '${shouldThrow}'`);
  }
}

typeCheckTest(
  `
let main = fn () void {
  print("hello, world!");
}
`,
  ctx([{ print: funcType({ param: strType, return: voidType }) }]),
);

typeCheckTest(
  `
let fac = fn (n int) int {
  if (n == 1) {
    1
  } else {
    n * fac(n - 1)
  }
}

let main = fn () void {
  print(i2s(fac(10)));
}
`,
  ctx([
    {
      print: funcType({ param: strType, return: voidType }),
      i2s: funcType({ param: intType, return: strType }),
    },
  ]),
);

typeCheckTest(
  `
let fac = fn (n int) int {
  if (n == 1) {
    1
  } else {
    n * fac(n - 1)
  }
}

let print_int = fn (n int) void {
  print(i2s(n))
}

let main = fn () void {
  print_int(fac(10))
}
`,
  ctx([
    {
      print: funcType({ param: strType, return: voidType }),
      i2s: funcType({ param: intType, return: strType }),
    },
  ]),
);

typeCheckTest(
  `
let fac = fn (n int) int {
  if (n == 1) {
    1
  } else {
    n * fac(n - 1)
  }
}

let print_int = fn (n int, blah str) void {
  print(i2s(n))
}

let main = fn () void {
  print_int(fac(10))
}
`,
  ctx([
    {
      print: funcType({ param: strType, return: voidType }),
      i2s: funcType({ param: intType, return: strType }),
    },
  ]),
  'Function parameter type mismatch: expected (int, str), found int at 15:13',
);

// no void decl tests
typeCheckTest(
  `
let f = fn () void {}
let x: void = f()
`,
  ctx(),
  'A decl type cannot contain void: found void at 3:1',
);
typeCheckTest(
  `
let f = fn () void {}
let x = f()
`,
  ctx(),
  'A decl type cannot contain void: found void at 3:1',
);
typeCheckTest(
  `
let f = fn () void {}
let x = (1, f())
`,
  ctx(),
  'A decl type cannot contain void: found (int, void) at 3:1',
);
typeCheckTest(
  `
let f = fn () void {}
let x = (1, ("hello", f(), false))
`,
  ctx(),
  'A decl type cannot contain void: found (int, (str, void, bool)) at 3:1',
);
typeCheckTest(
  `
let f = fn () void {}
let x = [f()]
`,
  ctx(),
  'A decl type cannot contain void: found [void] at 3:1',
);
typeCheckTest(
  `
let f = fn () void {
  let x: void = f()
}
`,
  ctx(),
  'A decl type cannot contain void: found void at 3:3',
);
typeCheckTest(
  `
let f = fn () void {
  let x = f()
}
`,
  ctx(),
  'A decl type cannot contain void: found void at 3:3',
);
typeCheckTest(
  `
let f = fn () void {
  let x = (1, f())
}
`,
  ctx(),
  'A decl type cannot contain void: found (int, void) at 3:3',
);
typeCheckTest(
  `
let f = fn () void {
  let x = (1, ("hello", f(), false))
}
`,
  ctx(),
  'A decl type cannot contain void: found (int, (str, void, bool)) at 3:3',
);
typeCheckTest(
  `
let f = fn () void {
  let x = [f()]
}
`,
  ctx(),
  'A decl type cannot contain void: found [void] at 3:3',
);

console.log(chalk.green.bold('Passed!'));
