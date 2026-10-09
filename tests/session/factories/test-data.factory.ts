/**
 * 测试数据工厂
 * 用于生成各种测试场景所需的数据
 */

export interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  role: 'user' | 'admin' | 'moderator';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  failedLoginAttempts: number;
  lockedUntil?: Date;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  refreshToken?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string;
  userAgent: string;
  isValid: boolean;
}

export interface LoginAttempt {
  id: string;
  userId: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  failureReason?: string;
  attemptedAt: Date;
}

export interface TokenPayload {
  userId: string;
  username: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
  sub?: string;
}

export class TestDataFactory {
  private static counter = 0;

  /**
   * 创建测试用户
   */
  static createUser(overrides: Partial<User> = {}): User {
    this.counter++;
    const now = new Date();
    
    return {
      id: `user_${this.counter}_${Date.now()}`,
      username: `testuser_${this.counter}`,
      email: `testuser_${this.counter}@example.com`,
      password: 'TestPassword123!',
      role: 'user',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      failedLoginAttempts: 0,
      ...overrides,
    };
  }

  /**
   * 创建管理员用户
   */
  static createAdminUser(overrides: Partial<User> = {}): User {
    return this.createUser({
      role: 'admin',
      username: `admin_${this.counter}`,
      email: `admin_${this.counter}@example.com`,
      ...overrides,
    });
  }

  /**
   * 创建被锁定的用户
   */
  static createLockedUser(overrides: Partial<User> = {}): User {
    const lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30分钟后解锁
    
    return this.createUser({
      failedLoginAttempts: 5,
      lockedUntil,
      ...overrides,
    });
  }

  /**
   * 创建非活跃用户
   */
  static createInactiveUser(overrides: Partial<User> = {}): User {
    return this.createUser({
      isActive: false,
      ...overrides,
    });
  }

  /**
   * 创建测试会话
   */
  static createSession(userId: string, overrides: Partial<Session> = {}): Session {
    this.counter++;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1小时后过期
    
    return {
      id: `session_${this.counter}_${Date.now()}`,
      userId,
      token: this.generateTestToken(),
      refreshToken: this.generateTestToken(),
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0 (Test Browser)',
      isValid: true,
      ...overrides,
    };
  }

  /**
   * 创建过期的会话
   */
  static createExpiredSession(userId: string, overrides: Partial<Session> = {}): Session {
    const now = new Date();
    const expiresAt = new Date(now.getTime() - 60 * 60 * 1000); // 1小时前过期
    
    return this.createSession(userId, {
      expiresAt,
      isValid: false,
      ...overrides,
    });
  }

  /**
   * 创建登录尝试记录
   */
  static createLoginAttempt(
    userId: string,
    success: boolean = true,
    overrides: Partial<LoginAttempt> = {}
  ): LoginAttempt {
    this.counter++;
    const now = new Date();
    
    return {
      id: `attempt_${this.counter}_${Date.now()}`,
      userId,
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0 (Test Browser)',
      success,
      failureReason: success ? undefined : 'Invalid credentials',
      attemptedAt: now,
      ...overrides,
    };
  }

  /**
   * 创建成功的登录尝试
   */
  static createSuccessfulLoginAttempt(
    userId: string,
    overrides: Partial<LoginAttempt> = {}
  ): LoginAttempt {
    return this.createLoginAttempt(userId, true, overrides);
  }

  /**
   * 创建失败的登录尝试
   */
  static createFailedLoginAttempt(
    userId: string,
    failureReason: string = 'Invalid credentials',
    overrides: Partial<LoginAttempt> = {}
  ): LoginAttempt {
    return this.createLoginAttempt(userId, false, {
      failureReason,
      ...overrides,
    });
  }

  /**
   * 创建JWT payload
   */
  static createTokenPayload(user: Partial<User> = {}, overrides: Partial<TokenPayload> = {}): TokenPayload {
    const now = Math.floor(Date.now() / 1000);
    
    return {
      userId: user.id || `user_${this.counter}`,
      username: user.username || `testuser_${this.counter}`,
      email: user.email || `testuser_${this.counter}@example.com`,
      role: user.role || 'user',
      iat: now,
      exp: now + 3600, // 1小时后过期
      iss: 'codepilot-test',
      aud: 'codepilot-client',
      sub: user.id || `user_${this.counter}`,
      ...overrides,
    };
  }

  /**
   * 创建过期的JWT payload
   */
  static createExpiredTokenPayload(user: Partial<User> = {}): TokenPayload {
    const now = Math.floor(Date.now() / 1000);
    
    return this.createTokenPayload(user, {
      iat: now - 7200, // 2小时前创建
      exp: now - 3600, // 1小时前过期
    });
  }

  /**
   * 创建测试用JWT token
   */
  static generateTestToken(payload: any = {}): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify({
      ...this.createTokenPayload(),
      ...payload,
    }));
    const signature = btoa(`${encodedHeader}.${encodedPayload}.test-secret`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * 创建过期的测试token
   */
  static generateExpiredToken(): string {
    return this.generateTestToken(this.createExpiredTokenPayload());
  }

  /**
   * 创建批量测试用户
   */
  static createUsers(count: number, overrides: Partial<User> = {}): User[] {
    return Array(count).fill(null).map(() => this.createUser(overrides));
  }

  /**
   * 创建批量测试会话
   */
  static createSessions(userIds: string[], overrides: Partial<Session> = {}): Session[] {
    return userIds.map(userId => this.createSession(userId, overrides));
  }

  /**
   * 创建测试配置
   */
  static createTestConfig(overrides: any = {}): any {
    return {
      jwtSecret: 'test-secret-key',
      jwtExpiration: '1h',
      refreshTokenExpiration: '7d',
      sessionTimeout: 3600,
      maxLoginAttempts: 5,
      lockoutDuration: 900,
      passwordMinLength: 8,
      passwordRequireUppercase: true,
      passwordRequireLowercase: true,
      passwordRequireNumbers: true,
      passwordRequireSpecialChars: true,
      ...overrides,
    };
  }

  /**
   * 创建测试请求头
   */
  static createAuthHeaders(token: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * 创建测试请求体
   */
  static createLoginRequest(overrides: any = {}): any {
    return {
      username: `testuser_${Date.now()}`,
      password: 'TestPassword123!',
      ...overrides,
    };
  }

  /**
   * 创建测试注册请求体
   */
  static createRegisterRequest(overrides: any = {}): any {
    return {
      username: `newuser_${Date.now()}`,
      email: `newuser_${Date.now()}@example.com`,
      password: 'TestPassword123!',
      confirmPassword: 'TestPassword123!',
      ...overrides,
    };
  }

  /**
   * 重置计数器
   */
  static resetCounter(): void {
    this.counter = 0;
  }

  /**
   * 创建测试场景数据集
   */
  static createTestScenario(scenario: 'happy-path' | 'edge-cases' | 'security' | 'performance'): any {
    switch (scenario) {
      case 'happy-path':
        return {
          users: [
            this.createUser({ username: 'valid_user1', email: 'valid1@example.com' }),
            this.createUser({ username: 'valid_user2', email: 'valid2@example.com' }),
          ],
          sessions: [],
          loginAttempts: [],
        };
        
      case 'edge-cases':
        return {
          users: [
            this.createUser({ username: 'a'.repeat(3), email: 'min@example.com' }), // 最小长度
            this.createUser({ username: 'a'.repeat(50), email: 'max@example.com' }), // 最大长度
            this.createLockedUser(),
            this.createInactiveUser(),
          ],
          sessions: [],
          loginAttempts: [],
        };
        
      case 'security':
        return {
          users: [
            this.createAdminUser(),
            this.createUser(),
            this.createLockedUser(),
          ],
          sessions: [
            this.createExpiredSession('user_exp'),
          ],
          loginAttempts: [
            this.createFailedLoginAttempt('user_fail1', 'Invalid password'),
            this.createFailedLoginAttempt('user_fail2', 'Account locked'),
            this.createSuccessfulLoginAttempt('user_success'),
          ],
        };
        
      case 'performance':
        return {
          users: this.createUsers(100),
          sessions: [],
          loginAttempts: [],
        };
        
      default:
        return {
          users: [],
          sessions: [],
          loginAttempts: [],
        };
    }
  }
}

// 导出默认实例
export default TestDataFactory;
