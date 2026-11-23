// ==========================================
// FILE: src/services/fafsaCredentialMapper.test.ts
// ==========================================
import { describe, expect, it } from 'vitest';
import type { ResidentHouseholdRecord } from '../types/education';
import {
  FafsaCredentialMapper,
  FafsaMappingError,
  isCountableAsset
} from './fafsaCredentialMapper';

const secret = 'test-hmac-secret-at-least-16';

function household(overrides: Partial<ResidentHouseholdRecord> = {}): ResidentHouseholdRecord {
  return {
    householdId: 'internal-household-id-must-not-appear',
    awardYear: '2026-27',
    dependencyStatus: 'INDEPENDENT',
    student: {
      role: 'STUDENT',
      agi: 25000,
      taxesPaid: 3000,
      untaxedIncome: 500,
      incomeAllowance: 0,
      assets: [{ owner: 'STUDENT', type: 'CASH_OR_SAVINGS', balance: 1000 }],
      consentProvided: true
    },
    selectedFederalSchoolCodes: ['001807', '001807', '009917'],
    ...overrides
  };
}

describe('FAFSA household credential mapper', () => {
  it('maps independent student fields without leaking the household ID', () => {
    const payload = new FafsaCredentialMapper(secret).map(household());

    expect(payload.student.role).toBe('STUDENT');
    expect(payload.student.agi).toBe(25000);
    expect(payload.parents).toEqual([]);
    expect(payload.selectedFederalSchoolCodes).toEqual(['001807', '009917']);
    expect(JSON.stringify(payload)).not.toContain('internal-household-id-must-not-appear');
    expect(payload.integrity.algorithm).toBe('HMAC-SHA256');
    expect(payload.integrity.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces a stable HMAC signature for canonically equivalent payloads', () => {
    const mapper = new FafsaCredentialMapper(secret);
    const first = mapper.map(household());
    const second = mapper.map(household());

    expect(first.integrity.signature).toBe(second.integrity.signature);
  });

  it('rejects a missing dependent parent contributor', () => {
    expect(() => new FafsaCredentialMapper(secret).map(household({
      dependencyStatus: 'DEPENDENT',
      contributors: undefined
    }))).toThrowError(FafsaMappingError);

    try {
      new FafsaCredentialMapper(secret).map(household({ dependencyStatus: 'DEPENDENT' }));
    } catch (error) {
      expect((error as FafsaMappingError).code).toBe('MISSING_PARENT_DATA');
    }
  });

  it('distinguishes valid zero parent values from missing parent consent', () => {
    const mapper = new FafsaCredentialMapper(secret);
    const valid = mapper.map(household({
      dependencyStatus: 'DEPENDENT',
      contributors: [{
        role: 'PARENT',
        agi: 0,
        taxesPaid: 0,
        untaxedIncome: 0,
        assets: [],
        consentProvided: true
      }]
    }));

    expect(valid.parents[0].agi).toBe(0);

    expect(() => mapper.map(household({
      dependencyStatus: 'DEPENDENT',
      contributors: [{
        role: 'PARENT',
        agi: 0,
        taxesPaid: 0,
        untaxedIncome: 0,
        assets: [],
        consentProvided: false
      }]
    }))).toThrowError(FafsaMappingError);
  });

  it('marks excluded 2026-27 assets as non-countable', () => {
    expect(isCountableAsset({ owner: 'STUDENT', type: 'RETIREMENT', balance: 100000 }, '2026-27')).toBe(false);
    expect(isCountableAsset({ owner: 'STUDENT', type: 'PRIMARY_RESIDENCE', balance: 500000 }, '2026-27')).toBe(false);
    expect(isCountableAsset({ owner: 'GRANDPARENT', type: 'GRANDPARENT_529', balance: 200000 }, '2026-27')).toBe(false);
  });

  it('excludes small family businesses and farms below 100 FTEs', () => {
    expect(isCountableAsset({
      owner: 'PARENT',
      type: 'SMALL_BUSINESS',
      balance: 300000,
      fullTimeEquivalentEmployees: 12
    }, '2026-27')).toBe(false);

    expect(isCountableAsset({
      owner: 'PARENT',
      type: 'FAMILY_FARM',
      balance: 400000,
      fullTimeEquivalentEmployees: 99
    }, '2026-27')).toBe(false);

    expect(isCountableAsset({
      owner: 'PARENT',
      type: 'SMALL_BUSINESS',
      balance: 300000,
      fullTimeEquivalentEmployees: 100
    }, '2026-27')).toBe(true);
  });

  it('requires explicit consent for every mapped contributor', () => {
    expect(() => new FafsaCredentialMapper(secret).map(household({
      student: {
        role: 'STUDENT',
        agi: 0,
        taxesPaid: 0,
        untaxedIncome: 0,
        assets: [],
        consentProvided: false
      }
    }))).toThrowError(FafsaMappingError);
  });

  it('rejects null and non-finite financial values', () => {
    expect(() => new FafsaCredentialMapper(secret).map(household({
      student: {
        role: 'STUDENT',
        agi: null,
        taxesPaid: 0,
        untaxedIncome: 0,
        assets: [],
        consentProvided: true
      }
    }))).toThrowError(FafsaMappingError);

    expect(() => new FafsaCredentialMapper(secret).map(household({
      student: {
        role: 'STUDENT',
        agi: Infinity,
        taxesPaid: 0,
        untaxedIncome: 0,
        assets: [],
        consentProvided: true
      }
    }))).toThrowError(FafsaMappingError);
  });

  it('rejects unsupported award years and weak HMAC secrets', () => {
    expect(() => new FafsaCredentialMapper(secret).map(household({ awardYear: '2025-26' })))
      .toThrowError(FafsaMappingError);

    expect(() => new FafsaCredentialMapper('weak')).toThrowError(FafsaMappingError);
  });
});
