import * as LocalAuthentication from 'expo-local-authentication';
import type { Translator } from '@codeo/i18n';

/** Why a decision was not sent. The message is already translated for the approval card. */
export class DecisionNotConfirmedError extends Error {
  constructor(
    readonly reason: 'cancelled' | 'not-configured' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'DecisionNotConfirmedError';
  }
}

/**
 * Asks the person holding the phone to prove it is them (Face ID, Touch ID, or the device passcode as the
 * system's own fallback) before an approval decision leaves the phone. Throws when it is not confirmed, so
 * nothing is sent; a phone with no lock at all cannot decide approvals.
 */
export async function confirmDecision(t: Translator): Promise<void> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    throw new DecisionNotConfirmedError('not-configured', t('approvals.biometric.notConfigured'));
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: t('approvals.biometric.prompt'),
    cancelLabel: t('approvals.biometric.cancel'),
    disableDeviceFallback: false,
  });
  if (result.success) return;
  switch (result.error) {
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
      throw new DecisionNotConfirmedError('cancelled', t('approvals.biometric.cancelled'));
    case 'not_enrolled':
    case 'passcode_not_set':
    case 'not_available':
      throw new DecisionNotConfirmedError('not-configured', t('approvals.biometric.notConfigured'));
    default:
      throw new DecisionNotConfirmedError('failed', t('approvals.biometric.failed'));
  }
}
