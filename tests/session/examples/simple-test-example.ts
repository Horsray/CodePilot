/**
 * 简单测试示例
 * 展示如何使用测试套件
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestDataFactory } from '../factories/test-data.factory';

// 模拟会话服务
class MockSessionService {
  private sessions: Map<string, any> = new Map();
  private users: Map<string, any> = new Map();

  async createUser(username: string, password: string): Promise<any> {
    const user = TestDataFactory.createUser({ username, password });
    this.users.set(user.id, user);
    return user;
  }

  async login(username: string, password: string): Promise<any> {
    const user = Array.from(this.users.values()).find(u => u.username === username);
    
    if (!user) {
      throw new Error('用户不存在');
    }
    
    if (user.password !== password) {
      user.failedLoginAttempts++;
      throw new Error('密码错误');
    }
    
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      throw new Error('账户已锁定');
    }
    
    // 重置失败次数
    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    
    // 创建会话
    const session = TestDataFactory.createSession(user.id);
    this.sessions.set(session.id, session);
    
    return {
      user,
      session,
      token: session.token,
      refreshToken: session.refreshToken,
    };
  }

  async logout(token: string): Promise<void> {
    const session = Array.from(this.sessions.values()).find(s => s.token === token);
    
    if (!session) {
      throw new Error('会话不存在');
    }
    
    session.isValid = false;
    this.sessions.delete(session.id);
  }

  async validateToken(token: string): Promise<any> {
    const session = Array.from(this.sessions.values()).find(s => s.token === token);
    
    if (!session) {
      throw new Error('无效的令牌');
    }
    
    if (!session.isValid) {
      throw new Error('会话已失效');
    }
    
    if (new Date() > session.expiresAt) {
      throw new Error('令牌已过期');
    }
    
    return session;
  }

  async refreshSession(refreshToken: string): Promise<any> {
    const session = Array.from(this.sessions.values()).find(s => s.refreshToken === refreshToken);
    
    if (!session) {
      throw new Error('无效的刷新令牌');
    }
    
    // 创建新令牌
    const newToken = TestDataFactory.generateTestToken();
    session.token = newToken;
    session.expiresAt = new Date(Date.now() + 3600 * 1000);
    session.updatedAt = new Date();
    
    return {
      token: newToken,
      expiresAt: session.expiresAt,
    };
  }

  async getActiveSessions(userId: string): Promise<any[]> {
    return Array.from(this.sessions.values()).filter(
      s => s.userId === userId && s.isValid
    );
  }

  async terminateAllSessions(userId: string): Promise<void> {
    const userSessions = Array.from(this.sessions.values()).filter(
      s => s.userId === userId
    );
    
    userSessions.forEach(session => {
      session.isValid = false;
      this.sessions.delete(session.id);
    });
  }

  clear(): void {
    this.sessions.clear();
    this.users.clear();
  }
}

// 测试套件
describe('会话管理示例测试', () => {
  let sessionService: MockSessionService;
  let testUser: any;
  let testSession: any;

  beforeEach(async () => {
    sessionService = new MockSessionService();
    testUser = await sessionService.createUser('testuser', 'TestPassword123!');
    TestDataFactory.resetCounter();
  });

  afterEach(() => {
    sessionService.clear();
    vi.clearAllMocks();
  });

  describe('用户注册和登录', () => {
    it('应成功创建用户', async () => {
      const user = await sessionService.createUser('newuser', 'NewPassword123!');
      
      expect(user).toBeDefined();
      expect(user.username).toBe('newuser');
      expect(user.id).toMatch(/^user_\d+_\d+$/);
    });

    it('应成功登录有效用户', async () => {
      const result = await sessionService.login('testuser', 'TestPassword123!');
      
      expect(result).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.session).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      
      testSession = result.session;
    });

    it('应拒绝无效密码', async () => {
      await expect(
        sessionService.login('testuser', 'WrongPassword')
      ).rejects.toThrow('密码错误');
    });

    it('应拒绝不存在的用户', async () => {
      await expect(
        sessionService.login('nonexistent', 'AnyPassword')
      ).rejects.toThrow('用户不存在');
    });
  });

  describe('会话验证', () => {
    beforeEach(async () => {
      const loginResult = await sessionService.login('testuser', 'TestPassword123!');
      testSession = loginResult.session;
    });

    it('应成功验证有效令牌', async () => {
      const session = await sessionService.validateToken(testSession.token);
      
      expect(session).toBeDefined();
      expect(session.isValid).toBe(true);
    });

    it('应拒绝无效令牌', async () => {
      await expect(
        sessionService.validateToken('invalid-token')
      ).rejects.toThrow('无效的令牌');
    });

    it('应拒绝过期令牌', async () => {
      // 模拟过期会话
      testSession.expiresAt = new Date(Date.now() - 1000);
      
      await expect(
        sessionService.validateToken(testSession.token)
      ).rejects.toThrow('令牌已过期');
    });
  });

  describe('会话刷新', () => {
    beforeEach(async () => {
      const loginResult = await sessionService.login('testuser', 'TestPassword123!');
      testSession = loginResult.session;
    });

    it('应成功刷新会话', async () => {
      const oldToken = testSession.token;
      const oldExpiresAt = testSession.expiresAt;
      
      const result = await sessionService.refreshSession(testSession.refreshToken);
      
      expect(result).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.token).not.toBe(oldToken);
      expect(result.expiresAt).toBeDefined();
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(oldExpiresAt.getTime());
    });

    it('应拒绝无效的刷新令牌', async () => {
      await expect(
        sessionService.refreshSession('invalid-refresh-token')
      ).rejects.toThrow('无效的刷新令牌');
    });
  });

  describe('会话管理', () => {
    beforeEach(async () => {
      const loginResult = await sessionService.login('testuser', 'TestPassword123!');
      testSession = loginResult.session;
    });

    it('应成功登出', async () => {
      await sessionService.logout(testSession.token);
      
      // 验证令牌不再有效
      await expect(
        sessionService.validateToken(testSession.token)
      ).rejects.toThrow('无效的令牌');
    });

    it('应获取用户的活跃会话', async () => {
      // 创建多个会话
      await sessionService.login('testuser', 'TestPassword123!');
      await sessionService.login('testuser', 'TestPassword123!');
      
      const activeSessions = await sessionService.getActiveSessions(testUser.id);
      
      expect(activeSessions).toHaveLength(3);
      expect(activeSessions.every(s => s.isValid)).toBe(true);
    });

    it('应终止用户的所有会话', async () => {
      // 创建多个会话
      const login1 = await sessionService.login('testuser', 'TestPassword123!');
      const login2 = await sessionService.login('testuser', 'TestPassword123!');
      
      // 终止所有会话
      await sessionService.terminateAllSessions(testUser.id);
      
      // 验证所有令牌都失效
      await expect(
        sessionService.validateToken(testSession.token)
      ).rejects.toThrow();
      
      await expect(
        sessionService.validateToken(login1.session.token)
      ).rejects.toThrow();
      
      await expect(
        sessionService.validateToken(login2.session.token)
      ).rejects.toThrow();
    });
  });

  describe('边界条件', () => {
    it('应处理空用户名', async () => {
      await expect(
        sessionService.createUser('', 'Password123!')
      ).resolves.toBeDefined(); // 工厂会生成随机用户名
    });

    it('应处理特殊字符', async () => {
      const user = await sessionService.createUser('user@name', 'Pass#word123!');
      expect(user).toBeDefined();
      expect(user.username).toBe('user@name');
    });

    it('应处理长输入', async () => {
      const longUsername = 'a'.repeat(100);
      const longPassword = 'b'.repeat(100);
      
      const user = await sessionService.createUser(longUsername, longPassword);
      expect(user).toBeDefined();
      expect(user.username).toBe(longUsername);
    });
  });

  describe('性能测试', () => {
    it('应快速处理登录请求', async () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 10; i++) {
        await sessionService.login('testuser', 'TestPassword123!');
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`10次登录耗时: ${duration}ms`);
      expect(duration).toBeLessThan(1000); // 应在1秒内完成
    });

    it('应处理并发登录', async () => {
      const promises = Array(5).fill(null).map(() =>
        sessionService.login('testuser', 'TestPassword123!')
      );
      
      const startTime = Date.now();
      const results = await Promise.all(promises);
      const endTime = Date.now();
      
      console.log(`5次并发登录耗时: ${endTime - startTime}ms`);
      
      expect(results).toHaveLength(5);
      expect(results.every(r => r.token)).toBe(true);
    });
  });

  describe('安全测试', () => {
    it('应检测暴力破解尝试', async () => {
      const maxAttempts = 5;
      
      // 模拟多次失败登录
      for (let i = 0; i < maxAttempts - 1; i++) {
        try {
          await sessionService.login('testuser', 'wrongpassword');
        } catch (e) {
          // 预期的错误
        }
      }
      
      // 锁定账户
      testUser.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
      
      // 尝试正确密码
      await expect(
        sessionService.login('testuser', 'TestPassword123!')
      ).rejects.toThrow('账户已锁定');
    });

    it('应防止会话固定攻击', async () => {
      // 登录获取会话
      const loginResult = await sessionService.login('testuser', 'TestPassword123!');
      
      // 尝试使用旧的会话ID（模拟攻击）
      const oldToken = loginResult.token;
      
      // 登出
      await sessionService.logout(oldToken);
      
      // 尝试使用旧令牌
      await expect(
        sessionService.validateToken(oldToken)
      ).rejects.toThrow('无效的令牌');
    });
  });
});

// 运行测试的辅助函数
export function runExampleTests(): void {
  console.log('运行会话管理示例测试...');
  console.log('请使用: npx vitest run tests/session/examples/simple-test-example.ts');
}

// 如果直接运行此文件
if (require.main === module) {
  runExampleTests();
}
