import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  hashPassword,
  validateNewPassword,
  verifyPassword,
} from '../auth/password.util';
import { getNationalIdDetails } from '../user/national-id.util';
import { encryptNationalId } from '../user/national-id-encryption.util';
import { protectData } from '../parent-registration/registration.validation';
import { admissionPolicy } from './admission.policy';
import { protectVolunteerData } from './volunteer.validation';
import { VOLUNTEER_AGREEMENT_VERSION } from './volunteer.legal';
import { AdmissionRepository } from './admission.repository';
import { applicantToken, credentialHash } from './admission.security';
import { ApplicationCredentialsRepository } from './application-credentials.repository';
import {
  normalizeApplicantEmail,
  type ApplicantPasswordLoginDto,
  type ApplicantPasswordSignupDto,
} from './application-credentials.dto';
import { assertApplicantPasswordFeature } from './application-credentials.feature';

@Injectable()
export class ApplicationCredentialsService {
  private dummyHash?: Promise<string>;
  constructor(
    private readonly credentials: ApplicationCredentialsRepository,
    private readonly applications: AdmissionRepository,
  ) {}

  private session() {
    const token = applicantToken();
    return {
      token,
      hash: credentialHash('session', token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const dbError = error as { name?: string; original?: { code?: string } };
      if (
        dbError.name === 'SequelizeUniqueConstraintError' ||
        dbError.original?.code === '23505'
      )
        throw new ConflictException(
          'Unable to register; use login or contact support',
        );
      // ORM errors can contain hashes/bind parameters. Never propagate/log them.
      throw new ServiceUnavailableException(
        'Applicant authentication unavailable; retry safely',
      );
    }
  }

  async signup(input: ApplicantPasswordSignupDto) {
    assertApplicantPasswordFeature();
    const identity = getNationalIdDetails(input.identifier);
    const policy = admissionPolicy(input.registrationType);
    policy.assertAvailable('START');
    const loginEmail = normalizeApplicantEmail(input.email);
    if (
      typeof input.password !== 'string' ||
      input.password !== input.passwordConfirmation
    )
      throw new BadRequestException('Password confirmation does not match');
    const password = validateNewPassword(input.password, identity);
    if (password !== input.password)
      throw new BadRequestException(
        'Password must not start or end with whitespace',
      );
    return this.safe(async () => {
      // Argon2 runs outside transaction locks. Only the hash crosses into persistence.
      const passwordHash = await hashPassword(password);
      const session = this.session();
      return this.applications.transaction(async (t) => {
        await this.credentials.lockIdentity(identity.nationalIdHash, t);
        if (
          await this.credentials.identityUnavailable(identity.nationalIdHash, t)
        )
          throw new ConflictException(
            'Unable to register; use login or contact support',
          );
        const application = await this.applications.create(
          {
            registrationType: policy.type,
            nationalIdHash: identity.nationalIdHash,
            nationalIdEncrypted: encryptNationalId(
              identity.normalizedNationalId,
            ),
            branchId: null,
            status: 'DRAFT',
            revision: 0,
            currentStep: 1,
            documentStatus: 'PENDING',
            draftData:
              policy.type === 'VOLUNTEER'
                ? protectVolunteerData({
                    volunteer: { nationalId: identity.normalizedNationalId },
                    agreements: { version: VOLUNTEER_AGREEMENT_VERSION },
                  })
                : protectData({
                    parent1: { notApplicable: false },
                    parent2: { notApplicable: false },
                    trainee: { nationalId: identity.normalizedNationalId },
                  }),
          },
          t,
        );
        await this.credentials.create(
          {
            applicationId: application.id,
            nationalIdHash: identity.nationalIdHash,
            passwordHash,
            loginEmail,
          },
          t,
        );
        await this.credentials.session(
          application.id,
          session.hash,
          session.expiresAt,
          t,
        );
        await this.applications.event(application.id, 'CREATED', t);
        return { token: session.token, expiresAt: session.expiresAt };
      });
    });
  }

  async login(input: ApplicantPasswordLoginDto) {
    assertApplicantPasswordFeature();
    const identity = getNationalIdDetails(input.identifier);
    if (
      typeof input.password !== 'string' ||
      !input.password ||
      input.password.length > 128
    )
      throw new UnauthorizedException('Invalid credentials');
    return this.safe(async () => {
      const credential = await this.credentials.find(identity.nationalIdHash);
      // Missing identities still perform an Argon2 verification.
      this.dummyHash ??= hashPassword(applicantToken());
      const matches = await verifyPassword(
        credential?.passwordHash ?? (await this.dummyHash),
        input.password,
      );
      if (!credential || !matches)
        throw new UnauthorizedException('Invalid credentials');
      const session = this.session();
      return this.applications.transaction(async (t) => {
        await this.credentials.lockSession(credential.applicationId, t);
        const application = await this.applications.application(
          credential.applicationId,
          t,
        );
        const current = await this.credentials.find(identity.nationalIdHash, t);
        if (
          !current ||
          current.passwordHash !== credential.passwordHash ||
          (await this.credentials.hasUser(identity.nationalIdHash, t))
        )
          throw new UnauthorizedException('Invalid credentials');
        if (application.status === 'APPROVED' || application.provisionedUserId)
          throw new UnauthorizedException('Invalid credentials');
        admissionPolicy(application.registrationType).assertAvailable('READ');
        await this.credentials.session(
          credential.applicationId,
          session.hash,
          session.expiresAt,
          t,
        );
        return { token: session.token, expiresAt: session.expiresAt };
      });
    });
  }
}
