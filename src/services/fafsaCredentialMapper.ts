// ==========================================
// FILE: src/services/fafsaCredentialMapper.ts
// ==========================================
import { createHmac } from 'crypto';
import type {
  HouseholdAsset,
  HouseholdContributor,
  ResidentHouseholdRecord
} from '../types/education';

export interface MappedFafsaContributor {
  role: 'STUDENT' | 'SPOUSE' | 'PARENT';
  agi: number;
  taxesPaid: number;
  untaxedIncome: number;
  incomeAllowance: number;
  assets: Array<Omit<HouseholdAsset, 'fullTimeEquivalentEmployees'> & {
    countable: boolean;
  }>;
  consentProvided: boolean;
  eligibleNonFiler: boolean;
}

export interface MappedFafsaPayload {
  awardYear: string;
  dependencyStatus: 'DEPENDENT' | 'INDEPENDENT';
  student: MappedFafsaContributor;
  spouse?: MappedFafsaContributor;
  parents: MappedFafsaContributor[];
  selectedFederalSchoolCodes: string[];
  integrity: {
    algorithm: 'HMAC-SHA256';
    signature: string;
  };
}

export class FafsaMappingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FafsaMappingError';
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

function requireFiniteDollar(value: number | null | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FafsaMappingError('INVALID_FINANCIAL_VALUE', `${field} must be a finite number`);
  }
  return value === 0 ? 0 : Math.round(value);
}

function isCountableAsset202627(asset: HouseholdAsset): boolean {
  if (
    asset.type === 'RETIREMENT' ||
    asset.type === 'PRIMARY_RESIDENCE' ||
    asset.owner === 'GRANDPARENT' ||
    asset.type === 'GRANDPARENT_529'
  ) {
    return false;
  }

  if (asset.type === 'SMALL_BUSINESS' || asset.type === 'FAMILY_FARM') {
    const fte = asset.fullTimeEquivalentEmployees;
    if (typeof fte === 'number' && Number.isFinite(fte) && fte < 100) {
      return false;
    }
  }

  return true;
}

export function isCountableAsset(asset: HouseholdAsset, awardYear: string): boolean {
  if (awardYear === '2026-27') return isCountableAsset202627(asset);

  // Fail closed on unconfigured award years instead of silently applying 2026-27 rules.
  return false;
}

function mapAsset(asset: HouseholdAsset, awardYear: string) {
  const balance = requireFiniteDollar(asset.balance, `asset.${asset.type}.balance`);
  return {
    owner: asset.owner,
    type: asset.type,
    balance,
    countable: isCountableAsset(asset, awardYear)
  };
}

function mapContributor(
  contributor: HouseholdContributor,
  awardYear: string
): MappedFafsaContributor {
  if (!contributor || !Array.isArray(contributor.assets)) {
    throw new FafsaMappingError('INVALID_CONTRIBUTOR', 'Contributor and assets are required');
  }

  if (contributor.consentProvided !== true) {
    throw new FafsaMappingError(
      'CONTRIBUTOR_CONSENT_REQUIRED',
      `${contributor.role} contributor consent is required`
    );
  }

  if (!contributor.assets.every((asset) => asset && typeof asset === 'object')) {
    throw new FafsaMappingError('INVALID_ASSET', 'Household contains an invalid asset record');
  }

  return {
    role: contributor.role,
    agi: requireFiniteDollar(contributor.agi, `${contributor.role}.agi`),
    taxesPaid: requireFiniteDollar(contributor.taxesPaid, `${contributor.role}.taxesPaid`),
    untaxedIncome: requireFiniteDollar(
      contributor.untaxedIncome,
      `${contributor.role}.untaxedIncome`
    ),
    incomeAllowance: requireFiniteDollar(
      contributor.incomeAllowance ?? 0,
      `${contributor.role}.incomeAllowance`
    ),
    assets: contributor.assets.map((asset) => mapAsset(asset, awardYear)),
    consentProvided: true,
    eligibleNonFiler: contributor.eligibleNonFiler === true
  };
}

export class FafsaCredentialMapper {
  constructor(private readonly hmacSecret: string) {
    if (!hmacSecret || hmacSecret.trim().length < 16) {
      throw new FafsaMappingError(
        'INVALID_HMAC_SECRET',
        'HMAC-SHA256 secret must contain at least 16 characters'
      );
    }
  }

  public map(record: ResidentHouseholdRecord): MappedFafsaPayload {
    if (!record || typeof record !== 'object') {
      throw new FafsaMappingError('INVALID_HOUSEHOLD_RECORD', 'Resident household record is required');
    }

    if (record.awardYear !== '2026-27') {
      throw new FafsaMappingError(
        'UNSUPPORTED_AWARD_YEAR',
        `Award year ${record.awardYear} is not configured for FAFSA mapping`
      );
    }

    if (!record.selectedFederalSchoolCodes?.length) {
      throw new FafsaMappingError(
        'MISSING_SCHOOL_CODES',
        'At least one Federal School Code is required'
      );
    }

    const schoolCodes = [...new Set(record.selectedFederalSchoolCodes)].slice(0, 20);

    if (record.student?.role !== 'STUDENT') {
      throw new FafsaMappingError('INVALID_STUDENT_ROLE', 'Student contributor role is required');
    }

    const student = mapContributor(record.student, record.awardYear);

    let spouse: MappedFafsaContributor | undefined;
    if (record.spouse) spouse = mapContributor(record.spouse, record.awardYear);

    let parents: MappedFafsaContributor[] = [];

    if (record.dependencyStatus === 'DEPENDENT') {
      const parentContributors = (record.contributors ?? []).filter(
        (contributor) => contributor.role === 'PARENT'
      );

      if (parentContributors.length === 0) {
        throw new FafsaMappingError(
          'MISSING_PARENT_DATA',
          'Dependent residents require at least one parent contributor'
        );
      }

      parents = parentContributors.map((contributor) =>
        mapContributor(contributor, record.awardYear)
      );
    } else if (record.dependencyStatus !== 'INDEPENDENT') {
      throw new FafsaMappingError(
        'INVALID_DEPENDENCY_STATUS',
        'dependencyStatus must be DEPENDENT or INDEPENDENT'
      );
    }

    const unsignedPayload: Omit<MappedFafsaPayload, 'integrity'> = {
      awardYear: record.awardYear,
      dependencyStatus: record.dependencyStatus,
      student,
      ...(spouse ? { spouse } : {}),
      parents,
      selectedFederalSchoolCodes: schoolCodes
    };

    const signature = createHmac('sha256', this.hmacSecret)
      .update(canonicalize(unsignedPayload), 'utf8')
      .digest('hex');

    return {
      ...unsignedPayload,
      integrity: {
        algorithm: 'HMAC-SHA256',
        signature
      }
    };
  }
}
