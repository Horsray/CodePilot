/**
 * 会话管理集成测试套件
 * 整合功能、安全、性能和边界测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app';

describe('会话管理集成测试', () => {
  let authToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    // 登录获取令牌
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'integration_user',
        password: 'IntegrationPass123!',
      });

    authToken = loginResponse.body.token;
    refreshToken = loginResponse.body.refreshToken;
  });

  describe('完整登录-访问-登出流程', () => {
    it('应完成完整的用户会话生命周期', async () => {
      // 1. 验证令牌有效
      const protectedResponse = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(protectedResponse.body).toHaveProperty('data');

      // 2. 刷新令牌
      if (refreshToken) {
        const refreshResponse = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken })
          .expect(200);

        expect(refreshResponse.body).toHaveProperty('accessToken');
        
        // 使用新令牌
        authToken = refreshResponse.body.accessToken;
      }

      // 3. 使用新令牌访问
      const newProtectedResponse = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(newProtectedResponse.body).toHaveProperty('data');

      // 4. 登出
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 5. 验证登出后无法访问
      await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(401);
    });
  });

  describe('并发用户会话管理', () => {
    it('应处理多用户并发会话', async () => {
      const users = [
        { username: 'user1', password: 'Pass123!' },
        { username: 'user2', password: 'Pass123!' },
        { username: 'user3', password: 'Pass123!' },
      ];

      // 并发登录
      const loginPromises = users.map(user =>
        request(app)
          .post('/api/auth/login')
          .send(user)
      );

      const loginResponses = await Promise.all(loginPromises);
      const tokens = loginResponses.map(r => r.body.token);

      // 验证所有令牌
      const verifyPromises = tokens.map(token =>
        request(app)
          .get('/api/protected')
          .set('Authorization', `Bearer ${token}`)
      );

      const verifyResponses = await Promise.all(verifyPromises);

      // 所有都应该成功
      verifyResponses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // 并发登出
      const logoutPromises = tokens.map(token =>
        request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${token}`)
      );

      const logoutResponses = await Promise.all(logoutPromises);

      logoutResponses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('安全性和边界条件组合测试', () => {
    it('应抵抗组合攻击尝试', async () => {
      // 1. SQL注入尝试
      const sqlInjection = await request(app)
        .post('/api/auth/login')
        .send({
          username: "' OR '1'='1",
          password: "' OR '1'='1",
        });

      expect(sqlInjection.status).toBe(401);

      // 2. XSS尝试
      const xssAttempt = await request(app)
        .post('/api/auth/login')
        .send({
          username: '<script>alert("XSS")</script>',
          password: 'password',
        });

      expect(xssAttempt.status).toBe(401);
      const responseText = JSON.stringify(xssAttempt.body);
      expect(responseText).not.toContain('<script>');

      // 3. 超长输入
      const longInput = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'a'.repeat(10000),
          password: 'b'.repeat(10000),
        });

      expect(longInput.status).not.toBe(500);
    });

    it('应正确处理令牌边界条件', async () => {
      // 1. 空令牌
      await request(app)
        .get('/api/protected')
        .set('Authorization', '')
        .expect(401);

      // 2. 格式错误的令牌
      await request(app)
        .get('/api/protected')
        .set('Authorization', 'InvalidFormat')
        .expect(401);

      // 3. 过期令牌(模拟)
      // 假设我们有一个测试端点可以获取过期令牌
      // await request(app)
      //   .get('/api/protected')
      //   .set('Authorization', 'Bearer expired.token.here')
      //   .expect(401);
    });
  });

  describe('性能和稳定性测试', () => {
    it('应维持稳定的性能', async () => {
      const iterations = 10;
      const responseTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();

        await request(app)
          .post('/api/auth/login')
          .send({
            username: `perf_user_${i}`,
            password: 'PerfPass123!',
          });

        const endTime = Date.now();
        responseTimes.push(endTime - startTime);
      }

      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);

      console.log(`
        性能稳定性测试结果:
        - 平均响应时间: ${avgResponseTime.toFixed(2)}ms
        - 最大响应时间: ${maxResponseTime}ms
        - 响应时间标准差: ${calculateStdDev(responseTimes).toFixed(2)}ms
      `);

      // 响应时间应该相对稳定
      expect(avgResponseTime).toBeLessThan(1000);
      expect(maxResponseTime).toBeLessThan(2000);
    });
  });

  afterAll(async () => {
    // 清理测试数据
    // 在实际测试中，可能需要调用清理端点
    console.log('集成测试完成，清理测试数据...');
  });
});

// 辅助函数：计算标准差
function calculateStdDev(values: number[]): number {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(value => {
    const diff = value - avg;
    return diff * diff;
  });
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
  return Math.sqrt(avgSquareDiff);
}
