// ==========================================
// FILE: src/services/saiService.ts
// ==========================================
import type { DependencyStatus } from '../types/education';

export type AssetOwner = 'STUDENT' | 'SPOUSE' | 'PARENT' | 'GRANDPARENT';
export type AssetType =
  | 'CASH_OR_SAVINGS'
  | 'INVESTMENTS'
  | 'RETIREMENT'
  | 'PRIMARY_RESIDENCE'
  | 'SMALL_BUSINESS'
  | 'FAMILY_FARM'
  | 'GRANDPARENT_529'
  | 'OTHER';

export interface CountableAsset {
  owner: AssetOwner;
  type: AssetType;
  balance: number;
}

export interface SaiContributorData {
  agi: number;
  taxesPaid: number;
  untaxedIncome: number;
  assets: CountableAsset[];
  consentProvided?: boolean;
  incomeAllowance?: number;
}

export interface SaiCalculationInput {
  awardYear: '2026-27' | '2027-28' | string;
  dependencyStatus: DependencyStatus;
  eligibleNonFiler: boolean;
  student: SaiContributorData;
  spouse?: SaiContributorData;
  parent?: SaiContributorData;
}

export interface SaiResult {
  sai: number;
  estimatedPell: {
    isEstimated: true;
    awardYear: string;
    eligible: boolean;
    amount: number;
  };
  calculation: {
    raw: number;
    studentAssetContribution: number;
    parentAssetContribution: number;
  };
}

export class SaiValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SaiValidationError';
  }
}

const SAI_MIN = -1500;
const SAI_MAX = 999999;
const PELL_MAX_2026_27 = 7395;
const PELL_MIN_2026_27 = 740;
const PELL_SAI_CUTOFF_2026_27 = 14790;

function normalizeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    throw new SaiValidationError('NON_FINITE_VALUE', 'SAI calculation contains a non-finite value');
  }

  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

function validateDollar(value: number, fieldName: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SaiValidationError('INVALID_DOLLAR_VALUE', `${fieldName} must be a finite number`);
  }
}

function validateContributor(contributor: SaiContributorData, fieldName: string): void {
  validateDollar(contributor.agi, `${fieldName}.agi`);
  validateDollar(contributor.taxesPaid, `${fieldName}.taxesPaid`);
  validateDollar(contributor.untaxedIncome, `${fieldName}.untaxedIncome`);
  validateDollar(contributor.incomeAllowance ?? 0, `${fieldName}.incomeAllowance`);

  if (!Array.isArray(contributor.assets)) {
    throw new SaiValidationError('INVALID_ASSETS', `${fieldName}.assets must be an array`);
  }

  for (const asset of contributor.assets) {
    validateDollar(asset.balance, `${fieldName}.assets.balance`);
  }
}

export function isCountableAsset(asset: CountableAsset, awardYear: string): boolean {
  if (awardYear === '2026-27' || awardYear.startsWith('2026')) {
    if (
      asset.type === 'RETIREMENT' ||
      asset.type === 'PRIMARY_RESIDENCE' ||
      asset.type === 'GRANDPARENT_529'
    ) {
      return false;
    }
  }

  // Grandparent-owned assets are never a student/parent countable asset in this engine.
  if (asset.owner === 'GRANDPARENT') return false;

  // Preserve award-year configuration as the guard location instead of scattering rules.
  if (asset.type === 'SMALL_BUSINESS' || asset.type === 'FAMILY_FARM') {
    return false;
  }

  return true;
}

function calculateAssetContribution(
  assets: CountableAsset[],
  owner: AssetOwner,
  awardYear: string,
  rate: number
): number {
  return assets
    .filter((asset) => asset.owner === owner && isCountableAsset(asset, awardYear))
    .reduce((sum, asset) => sum + asset.balance, 0) * rate;
}

export function calculateStudentAidIndex(input: SaiCalculationInput): SaiResult {
  if (!input || typeof input !== 'object') {
    throw new SaiValidationError('INVALID_INPUT', 'SAI input is required');
  }

  validateContributor(input.student, 'student');

  if (input.dependencyStatus === 'DEPENDENT') {
    if (!input.parent) {
      throw new SaiValidationError(
        'MISSING_PARENT_DATA',
        'Dependent applicants require parent income and asset data'
      );
    }
    validateContributor(input.parent, 'parent');

    if (input.parent.consentProvided !== true) {
      throw new SaiValidationError(
        'MISSING_PARENT_CONSENT',
        'Dependent applicants require parent contributor consent'
      );
    }
  } else if (input.dependencyStatus !== 'INDEPENDENT') {
    throw new SaiValidationError('INVALID_DEPENDENCY_STATUS', 'dependencyStatus must be DEPENDENT or INDEPENDENT');
  }

  if (input.spouse) validateContributor(input.spouse, 'spouse');

  if (input.eligibleNonFiler === true) {
    return {
      sai: SAI_MIN,
      estimatedPell: estimatePellGrant(SAI_MIN, input.awardYear),
      calculation: { raw: SAI_MIN, studentAssetContribution: 0, parentAssetContribution: 0 }
    };
  }

  const studentIncome =
    input.student.agi - input.student.taxesPaid + input.student.untaxedIncome;
  const studentAllowance = input.student.incomeAllowance ?? 0;
  const spouseIncome = input.spouse
    ? input.spouse.agi - input.spouse.taxesPaid + input.spouse.untaxedIncome
    : 0;
  const spouseAllowance = input.spouse?.incomeAllowance ?? 0;

  const studentAssetContribution = calculateAssetContribution(
    input.student.assets,
    'STUDENT',
    input.awardYear,
    0.20
  );

  let parentAssetContribution = 0;
  let parentIncome = 0;

  if (input.dependencyStatus === 'DEPENDENT' && input.parent) {
    parentIncome =
      input.parent.agi - input.parent.taxesPaid + input.parent.untaxedIncome;
    parentAssetContribution = calculateAssetContribution(
      input.parent.assets,
      'PARENT',
      input.awardYear,
      0.0564
    );
  }

  const raw = normalizeInteger(
    studentIncome -
      studentAllowance +
      spouseIncome -
      spouseAllowance +
      parentIncome +
      studentAssetContribution +
      parentAssetContribution
  );

  const sai = normalizeInteger(Math.max(SAI_MIN, Math.min(SAI_MAX, raw)));

  return {
    sai,
    estimatedPell: estimatePellGrant(sai, input.awardYear),
    calculation: {
      raw,
      studentAssetContribution: normalizeInteger(studentAssetContribution),
      parentAssetContribution: normalizeInteger(parentAssetContribution)
    }
  };
}

export function estimatePellGrant(sai: number, awardYear: string) {
  if (awardYear === '2026-27') {
    if (!Number.isFinite(sai) || sai >= PELL_SAI_CUTOFF_2026_27) {
      return {
        isEstimated: true as const,
        awardYear,
        eligible: false,
        amount: 0
      };
    }

    if (sai <= 0) {
      return {
        isEstimated: true as const,
        awardYear,
        eligible: true,
        amount: PELL_MAX_2026_27
      };
    }

    const formulaAmount = PELL_MAX_2026_27 - sai;
    const roundedToNearestFive = Math.round(formulaAmount / 5) * 5;
    const amount = Math.max(PELL_MIN_2026_27, roundedToNearestFive);

    return {
      isEstimated: true as const,
      awardYear,
      eligible: true,
      amount
    };
  }

  return {
    isEstimated: true as const,
    awardYear,
    eligible: sai >= 0 && sai < 14790,
    amount: sai <= 0 ? 0 : Math.max(0, PELL_MAX_2026_27 - sai)
  };
}
