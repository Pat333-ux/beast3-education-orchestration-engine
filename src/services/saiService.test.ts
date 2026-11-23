// ==========================================
// FILE: src/services/saiService.test.ts
// ==========================================
import { describe, expect, it } from 'vitest';
import {
  calculateStudentAidIndex,
  SaiValidationError,
  type SaiCalculationInput,
  type SaiContributorData
} from './saiService';

function student(overrides: Partial<SaiContributorData> = {}): SaiContributorData {
  return {
    agi: 0,
    taxesPaid: 0,
    untaxedIncome: 0,
    assets: [],
    ...overrides
  };
}

function input(overrides: Partial<SaiCalculationInput> = {}): SaiCalculationInput {
  return {
    awardYear: '2026-27',
    dependencyStatus: 'INDEPENDENT',
    eligibleNonFiler: false,
    student: student(),
    ...overrides
  };
}

describe('Student Aid Index edge cases', () => {
  it('clamps an extremely negative raw index to -1500 and estimates max Pell', () => {
    const result = calculateStudentAidIndex(input({
      student: student({ agi: -10000, incomeAllowance: 10000 })
    }));

    expect(result.sai).toBe(-1500);
    expect(result.estimatedPell).toEqual({
      isEstimated: true,
      awardYear: '2026-27',
      eligible: true,
      amount: 7395
    });
  });

  it('forces eligible non-filers to -1500 after base assembly', () => {
    const result = calculateStudentAidIndex(input({
      eligibleNonFiler: true,
      student: student({
        agi: 5000,
        untaxedIncome: 100,
        assets: [{ owner: 'STUDENT', type: 'CASH_OR_SAVINGS', balance: 5000 }]
      })
    }));

    expect(result.sai).toBe(-1500);
  });

  it('returns integer zero, never negative zero, when income and allowances balance', () => {
    const result = calculateStudentAidIndex(input({
      student: student({ agi: 100, taxesPaid: 50, untaxedIncome: 50, incomeAllowance: 100 })
    }));

    expect(Object.is(result.sai, -0)).toBe(false);
    expect(result.sai).toBe(0);
  });

  it('returns integer mid-range SAI and deterministically rounds estimated Pell', () => {
    const result = calculateStudentAidIndex(input({
      student: student({ agi: 1350 })
    }));

    expect(Number.isInteger(result.sai)).toBe(true);
    expect(result.sai).toBeGreaterThanOrEqual(1);
    expect(result.sai).toBeLessThanOrEqual(6655);
    expect(result.estimatedPell.amount).toBeGreaterThanOrEqual(740);
  });

  it('flags Pell ineligible at or above the 2026-27 cutoff', () => {
    const result = calculateStudentAidIndex(input({
      student: student({ agi: 14790 })
    }));

    expect(result.sai).toBe(14790);
    expect(result.estimatedPell).toEqual({
      isEstimated: true,
      awardYear: '2026-27',
      eligible: false,
      amount: 0
    });
  });

  it('clamps strictly to the 999999 upper ceiling', () => {
    const result = calculateStudentAidIndex(input({
      student: student({ agi: 2000000 })
    }));

    expect(result.sai).toBe(999999);
  });

  it('keeps zero-valued dependent parent data distinct from missing data', () => {
    const valid = calculateStudentAidIndex(input({
      dependencyStatus: 'DEPENDENT',
      parent: student({ consentProvided: true, agi: 0, untaxedIncome: 0, assets: [] })
    }));

    expect(valid.sai).toBe(0);
  });

  it('throws structured validation when dependent parent data is missing', () => {
    expect(() => calculateStudentAidIndex(input({ dependencyStatus: 'DEPENDENT' })))
      .toThrowError(SaiValidationError);

    try {
      calculateStudentAidIndex(input({ dependencyStatus: 'DEPENDENT' }));
    } catch (error) {
      expect(error).toBeInstanceOf(SaiValidationError);
      expect((error as SaiValidationError).code).toBe('MISSING_PARENT_DATA');
    }
  });

  it('throws structured validation when parent consent is missing', () => {
    try {
      calculateStudentAidIndex(input({
        dependencyStatus: 'DEPENDENT',
        parent: student()
      }));
    } catch (error) {
      expect(error).toBeInstanceOf(SaiValidationError);
      expect((error as SaiValidationError).code).toBe('MISSING_PARENT_CONSENT');
    }
  });

  it('uses independent branch and excludes parent data that is not provided', () => {
    const result = calculateStudentAidIndex(input({
      dependencyStatus: 'INDEPENDENT',
      student: student({ agi: 1000 })
    }));

    expect(result.sai).toBe(1000);
  });

  it('excludes retirement, primary residence, grandparent 529, and small business/farm assets', () => {
    const result = calculateStudentAidIndex(input({
      student: student({
        assets: [
          { owner: 'STUDENT', type: 'RETIREMENT', balance: 100000 },
          { owner: 'STUDENT', type: 'PRIMARY_RESIDENCE', balance: 500000 },
          { owner: 'GRANDPARENT', type: 'GRANDPARENT_529', balance: 200000 },
          { owner: 'STUDENT', type: 'SMALL_BUSINESS', balance: 300000 },
          { owner: 'STUDENT', type: 'FAMILY_FARM', balance: 400000 }
        ]
      })
    }));

    expect(result.sai).toBe(0);
    expect(result.calculation.studentAssetContribution).toBe(0);
  });

  it('applies student and parent rates only to countable assets', () => {
    const result = calculateStudentAidIndex(input({
      dependencyStatus: 'DEPENDENT',
      student: student({
        assets: [{ owner: 'STUDENT', type: 'CASH_OR_SAVINGS', balance: 1000 }]
      }),
      parent: student({
        consentProvided: true,
        assets: [{ owner: 'PARENT', type: 'INVESTMENTS', balance: 10000 }]
      })
    }));

    expect(result.calculation.studentAssetContribution).toBe(200);
    expect(result.calculation.parentAssetContribution).toBe(564);
    expect(result.sai).toBe(764);
  });

  it('rejects NaN and Infinity rather than producing an invalid SAI', () => {
    expect(() => calculateStudentAidIndex(input({ student: student({ agi: NaN }) })))
      .toThrowError(SaiValidationError);

    expect(() => calculateStudentAidIndex(input({ student: student({ agi: Infinity }) })))
      .toThrowError(SaiValidationError);
  });
});
