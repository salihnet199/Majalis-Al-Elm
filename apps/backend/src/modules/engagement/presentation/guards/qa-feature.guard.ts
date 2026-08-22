import { Injectable, CanActivate, ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * QaFeatureGuard — enforces `feature_flag.qa` from ad_system_config.
 *
 * Applied at Controller class level on QuestionsController so that ALL
 * endpoints (including future additions) are covered automatically.
 * Prevents manual per-method checks and eliminates the risk of forgetting
 * the flag check when new Q&A endpoints are added.
 *
 * Config key: 'feature_flag.qa' (stored in ad_system_config, default: true)
 * Response when disabled: 503 SERVICE_UNAVAILABLE
 */
@Injectable()
export class QaFeatureGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const enabled = this.configService.get<boolean | string>('feature_flag.qa', true);
    // ad_system_config stores JSONB — may arrive as boolean or the string 'true'
    const isEnabled = enabled === true || enabled === 'true';
    if (!isEnabled) {
      throw new ServiceUnavailableException({
        code: 'QA_FEATURE_DISABLED',
        message: 'The Q&A feature is currently disabled',
      });
    }
    return true;
  }
}
