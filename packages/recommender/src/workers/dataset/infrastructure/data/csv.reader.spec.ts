import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCsvLine, parseLooseArray, parseLooseJson } from './csv.reader.js';

describe('leitor do dataset', () => {
  it('deve preservar vírgulas dentro de campos CSV entre aspas', () => {
    const values = parseCsvLine('1,"titulo, com virgula",filme');

    assert.deepEqual(values, ['1', 'titulo, com virgula', 'filme']);
  });

  it('deve aceitar pseudo-JSON do dataset', () => {
    const values = parseLooseArray("[{'name': 'Pessoa', 'adult': False}]");

    assert.deepEqual(values, [{ name: 'Pessoa', adult: false }]);
  });

  it('deve retornar nulo para pseudo-JSON inválido', () => {
    const value = parseLooseJson("[{'name':]");

    assert.equal(value, null);
  });
});
