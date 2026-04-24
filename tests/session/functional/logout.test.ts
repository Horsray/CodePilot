/**
 * 会话管理功能测试 - 登出测试
 * 测试ID: TC-LOGOUT-xxx
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app';

describe('TC-LOGOUT: 登出功能测试', () => {
  let authToken: string;

  // 辅助函数：登录获取token
  const loginAndGetToken = async (): Promise<string> => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'testuser',
        password: 'ValidPass123!',
      });
    
    return response.body.token;
  };

  beforeEach(async () => {
    // 每个测试前先登录
    authToken = await loginAndGetToken();
  });

  describe('TC-LOGOUT-001: 正常登出', () => {
    it('应成功登出并使会话失效', async () => {
      // 执行登出
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(logoutResponse.body).toHaveProperty('message');
      expect(logoutResponse.body.message).toContain('success');
    });

    it('登出后应清除会话Cookie', async () => {
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 检查是否设置了过期的Cookie
      const setCookieHeader = logoutResponse.headers['set-cookie'];
      if (setCookieHeader) {
        const cookie = Array.isArray(setCookieHeader) 
          ? setCookieHeader[0] 
          : setCookieHeader;
        
        // Cookie应该被清除 (Max-Age=0 或 Expires=过去时间)
        expect(
          cookie.includes('Max-Age=0') || 
          cookie.includes('expires=Thu, 01 Jan 1970')
        ).toBe(true);
      }
    });
  });

  describe('TC-LOGOUT-002: 登出后访问保护页面', () => {
    it('登出后应无法访问受保护资源', async () => {
      // 先登出
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 尝试访问受保护资源
      const protectedResponse = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(401);

      expect(protectedResponse.body).toHaveProperty('error');
      expect(protectedResponse.body.error).toContain('unauthorized');
    });

    it('应正确处理过期Token', async () => {
      // 使用一个明显过期或无效的Token
      const invalidToken = 'invalid.token.here';
      
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(response.body.error).toContain('invalid');
    });
  });

  describe('TC-LOGOUT-003: 并发登出', () => {
    it('多次登出请求应都成功(幂等性)', async () => {
      // 并发发送多个登出请求
      const logoutPromises = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${authToken}`)
      );

      const responses = await Promise.all(logoutPromises);

      // 所有请求都应成功
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('TC-LOGOUT-004: 安全性测试', () => {
    it('不应接受无Authorization头的登出请求', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('不应接受格式错误的Authorization头', async () => {
      const invalidAuthHeaders = [
        'Bearer',                    // 缺少token
        'Basic dGVzdDp0ZXN0',       // 错误的认证类型
        'Bearer invalid',            // 无效token
        authToken,                   // 缺少Bearer前缀
      ];

      for (const authHeader of invalidAuthHeaders) {
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', authHeader);

        expect(response.status).toBe(401);
      }
    });
  });
});
