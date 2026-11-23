// ==========================================
// FILE: src/types/education.ts
// ==========================================
export interface StudentProfile {
  id: string;
  firstName: string;
  lastName: string;
  ssn: string; // Encrypted before persistence
  dob: string;
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  academicTarget: {
    major: string;
    degreeType: 'ASSOCIATE' | 'BACHELOR' | 'CERTIFICATE' | 'MASTER';
    preferredState?: string;
    maxTuitionBudget?: number;
  };
  selectedSchoolCodes: string[]; // Up to 20 Federal School Codes for FAFSA
}

export type DependencyStatus = 'DEPENDENT' | 'INDEPENDENT';

export interface FafsaDataPayload {
  student: StudentProfile;
  dependencyStatus: DependencyStatus;
  contributorTaxInformation: {
    agi: number;
    taxesPaid: number;
    untaxedIncome: number;
  };
  selectedFederalSchoolCodes: string[];
}

export interface HouseholdAsset {
  owner: 'STUDENT' | 'SPOUSE' | 'PARENT' | 'GRANDPARENT';
  type:
    | 'CASH_OR_SAVINGS'
    | 'INVESTMENTS'
    | 'RETIREMENT'
    | 'PRIMARY_RESIDENCE'
    | 'SMALL_BUSINESS'
    | 'FAMILY_FARM'
    | 'GRANDPARENT_529'
    | 'OTHER';
  balance: number;
  fullTimeEquivalentEmployees?: number;
}

export interface HouseholdContributor {
  role: 'STUDENT' | 'SPOUSE' | 'PARENT';
  agi: number | null;
  taxesPaid: number | null;
  untaxedIncome: number | null;
  assets: HouseholdAsset[];
  consentProvided: boolean;
  eligibleNonFiler?: boolean;
  incomeAllowance?: number;
}

export interface ResidentHouseholdRecord {
  householdId: string;
  awardYear: '2026-27' | '2027-28' | string;
  dependencyStatus: DependencyStatus;
  student: HouseholdContributor;
  spouse?: HouseholdContributor;
  contributors?: HouseholdContributor[];
  selectedFederalSchoolCodes: string[];
}

export interface AutomationResult {
  step: 'ACCOUNT_SETUP' | 'FAFSA_PREFILL' | 'COLLEGE_APPLICATIONS';
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  details: string;
  payloadGenerated?: Record<string, unknown>;
}
