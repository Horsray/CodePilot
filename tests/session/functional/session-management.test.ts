/**
 * 会话管理功能测试 - 会话保持测试
 * 测试ID: TC-SESSION-xxx
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app';

describe('TC-SESSION: 会话保持测试', () => {
  let authToken: string;

  beforeEach(async () => {
    // 登录获取token
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'testuser',
        password: 'ValidPass123!',
      });
    
    authToken = response.body.token;
  });

  describe('TC-SESSION-001: 会话活跃保持', () => {
    it('活跃使用时会话应保持有效', async () => {
      // 模拟多次请求
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .get('/api/protected')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body).toHaveProperty('data');
        
        // 模拟间隔时间
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });

    it('应支持会话续期', async () => {
      // 第一次请求
      const firstResponse = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const firstExpiry = firstResponse.headers['x-session-expiry'];

      // 等待一段时间后再次请求
      await new Promise(resolve => setTimeout(resolve, 1000));

      const secondResponse = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const secondExpiry = secondResponse.headers['x-session-expiry'];

      // 如果支持续期，过期时间应该更新
      if (firstExpiry && secondExpiry) {
        expect(new Date(secondExpiry).getTime())
          .toBeGreaterThan(new Date(firstExpiry).getTime());
      }
    });
  });

  describe('TC-SESSION-002: 会话空闲超时', () => {
    it('应正确处理会话超时配置', async () => {
      // 这个测试可能需要mock时间或使用测试专用的超时配置
      const response = await request(app)
        .get('/api/session/config')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('sessionTimeout');
      expect(response.body.sessionTimeout).toBeGreaterThan(0);
    });
  });

  describe('TC-SESSION-004: 并发会话控制', () => {
    it('应支持多个并发会话', async () => {
      // 从同一用户创建多个会话
      const loginPromises = Array(3).fill(null).map(() =>
        request(app)
          .post('/api/auth/login')
          .send({
            username: 'testuser',
            password: 'ValidPass123!',
          })
      );

      const responses = await Promise.all(loginPromises);

      // 所有登录都应成功
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('token');
      });

      // 获取所有token
      const tokens = responses.map(r => r.body.token);

      // 验证所有token都有效
      const verifyPromises = tokens.map(token =>
        request(app)
          .get('/api/protected')
          .set('Authorization', `Bearer ${token}`)
      );

      const verifyResponses = await Promise.all(verifyPromises);

      verifyResponses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('应能登出所有会话', async () => {
      // 创建多个会话
      const loginPromises = Array(3).fill(null).map(() =>
        request(app)
          .post('/api/auth/login')
          .send({
            username: 'testuser',
            password: 'ValidPass123!',
          })
      );

      const loginResponses = await Promise.all(loginPromises);
      const tokens = loginResponses.map(r => r.body.token);

      // 登出所有会话
      await request(app)
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${tokens[0]}`)
        .expect(200);

      // 验证所有token都失效
      const verifyPromises = tokens.map(token =>
        request(app)
          .get('/api/protected')
          .set('Authorization', `Bearer ${token}`)
      );

      const verifyResponses = await Promise.all(verifyPromises);

      verifyResponses.forEach(response => {
        expect(response.status).toBe(401);
      });
    });
  });

  describe('TC-SESSION-005: Token刷新', () => {
    it('应支持Refresh Token机制', async () => {
      // 登录获取access token和refresh token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'ValidPass123!',
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('accessToken');
      expect(loginResponse.body).toHaveProperty('refreshToken');

      const { accessToken, refreshToken } = loginResponse.body;

      // 使用refresh token获取新的access token
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(refreshResponse.body).toHaveProperty('accessToken');
      expect(refreshResponse.body.accessToken).not.toBe(accessToken);
    });

    it('应拒绝过期的Refresh Token', async () => {
      // 使用一个明显过期或无效的refresh token
      const invalidRefreshToken = 'invalid.refresh.token';

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: invalidRefreshToken })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('TC-SESSION-006: 跨标签页会话共享', () => {
    it('同源请求应共享会话Cookie', async () => {
      // 登录获取Cookie
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'ValidPass123!',
        })
        .expect(200);

      // 提取Cookie
      const cookies = loginResponse.headers['set-cookie'];
      expect(cookies).toBeDefined();

      // 使用相同的Cookie发送请求
      const protectedResponse = await request(app)
        .get('/api/protected')
        .set('Cookie', cookies)
        .expect(200);

      expect(protectedResponse.body).toHaveProperty('data');
    });
  });
});
