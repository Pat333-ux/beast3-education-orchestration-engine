// ==========================================
// FILE: src/index.ts
// ==========================================
import { StudentProfile } from './types/education';
import { FafsaAutomationService } from './services/fafsaAutomationService';
import { CollegeApplicationService } from './services/collegeApplicationService';

export class NewWorldOrderEducationOrchestrator {
  private fafsaService: FafsaAutomationService;
  private collegeService: CollegeApplicationService;

  constructor() {
    this.fafsaService = new FafsaAutomationService();
    this.collegeService = new CollegeApplicationService();
  }

  public async runFullEducationPipeline(profile: StudentProfile) {
    console.log(`[+] Initializing Education Taskforce Workflow for Member: ${profile.firstName} ${profile.lastName}`);
    console.log(`[+] Organization: New World Order Health and Wellbeing Ministries DAO LLC`);

    // Step 1: Query matching schools for desired major
    const targetSchools = await this.collegeService.findMatchingSchools(profile.academicTarget.major);
    profile.selectedSchoolCodes = targetSchools.map((s) => s.federalSchoolCode);

    console.log(`[+] Found ${targetSchools.length} matching institutions for major: '${profile.academicTarget.major}'`);

    // Step 2: Prefill institutional college applications
    const applicationResults = await this.collegeService.prefillAllApplications(profile, targetSchools);

    // Step 3: Prefill FAFSA & Account setup package
    const fafsaResults = await this.fafsaService.executeFafsaWorkflow(profile);

    const fullAuditTrail = [...applicationResults, ...fafsaResults];

    return {
      status: 'COMPLETE',
      organization: 'New World Order Health and Wellbeing Ministries DAO LLC',
      totalSchoolsProcessed: targetSchools.length,
      auditTrail: fullAuditTrail,
    };
  }
}

// Direct Execution Verification Sample
if (require.main === module) {
  const orchestrator = new NewWorldOrderEducationOrchestrator();

  const sampleMemberProfile: StudentProfile = {
    id: 'nwo-mem-00912',
    firstName: 'Governing Officer',
    lastName: 'Tarwater',
    ssn: '000-00-0000',
    dob: '2000-01-01',
    email: 'illuminatedson49@gmail.com',
    phone: '8123264047',
    address: {
      street: '123 Civic Plaza',
      city: 'Terre Haute',
      state: 'IN',
      zipCode: '47807',
    },
    academicTarget: {
      major: 'Computer Science & Software Systems Architecture',
      degreeType: 'BACHELOR',
      preferredState: 'IN',
    },
    selectedSchoolCodes: [],
  };

  orchestrator.runFullEducationPipeline(sampleMemberProfile).then((res) => {
    console.log('--- SYSTEM PIPELINE COMPLETE ---');
    console.log(JSON.stringify(res, null, 2));
  });
}
