import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { getRequiredEnv } from 'src/config/env.util';
import AuthService from './auth.service';

const cookieExtractor = (request: Request) => {
  const cookieHeader = request?.headers?.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((cookie) => {
      const [name, ...valueParts] = cookie.trim().split('=');
      return [name, decodeURIComponent(valueParts.join('='))];
    }),
  );

  return cookies.access_token ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      secretOrKey: getRequiredEnv('JWT_SECRET'),
    });
  }

  async validate(payload: { sub?: string }) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.authService.getMe(payload.sub);

    if (!user.roles.length) {
      throw new UnauthorizedException('No active permissions');
    }

    return {
      userId: user.userId,
      roles: user.roles,
      activeBranch: user.activeBranch,
    };
  }
}
