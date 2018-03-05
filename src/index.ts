import chalk from 'chalk';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { tokenize } from './lexer';
import { LexError } from './lexer/error';
import { parse } from './parser';
import { ParseError } from './parser/error';
import { desugarBefore, desugarAfter } from './desugarer';
import { typeCheck } from './typechecker';
import { TypeContext } from './typechecker/context';
import { TypeError } from './typechecker/error';
import { Compose } from './util';

const compile = Compose.then(tokenize)
  .then(parse)
  .then(desugarBefore)
  .then(mod => typeCheck(mod, new TypeContext()))
  .then(desugarAfter).f;

function exitWithErrors(errors: Array<string>) {
  errors.forEach(err => console.error(err));
  process.exit(1);
}

function reportCompileError(
  input: string,
  err: LexError | ParseError | TypeError | any,
) {
  if (
    !(
      err instanceof LexError ||
      err instanceof ParseError ||
      err instanceof TypeError
    )
  ) {
    throw err;
  }

  const errors: Array<string> = [];

  errors.push(`${err.name}: ${err.message}\n`);

  const lineIdx = err.row - 1;
  const fromIdx = lineIdx < 1 ? 0 : lineIdx - 1;
  const toIdx = lineIdx + 2;
  const targetIdx = lineIdx - fromIdx;

  const lineNoDigitLen = toIdx.toString().length;

  input
    .split('\n')
    .slice(fromIdx, toIdx)
    .forEach((line, idx) => {
      const lineNo = fromIdx + idx + 1;
      errors.push(
        `${' '.repeat(lineNoDigitLen - lineNo.toString().length)}${chalk.grey(
          lineNo + '|',
        )} ${line}`,
      );

      if (targetIdx === idx) {
        errors.push(
          `  ${' '.repeat(lineNoDigitLen + err.column - 1)}${chalk.red('^')}`,
        );
      }
    });

  exitWithErrors(errors);
}

const relPaths = process.argv.slice(2);

if (!relPaths.length) {
  exitWithErrors(['No input file']);
}

relPaths.forEach(path => {
  const absPath = resolve(path);

  let input: string;

  try {
    input = readFileSync(absPath, 'utf-8');
  } catch (err) {
    return exitWithErrors([
      `Cannot open input file: ${path}`,
      '',
      chalk.red(err.message),
    ]);
  }

  try {
    compile(input);
  } catch (err) {
    return reportCompileError(input, err);
  }
});

console.log(chalk.green('Build succeeded!'));
