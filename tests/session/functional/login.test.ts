/**
 * 会话管理功能测试 - 登录测试
 * 测试ID: TC-LOGIN-xxx
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app'; // 假设的应用入口

describe('TC-LOGIN: 登录功能测试', () => {
  // 测试数据
  const validUser = {
    username: 'testuser',
    password: 'ValidPass123!',
  };

  const invalidUser = {
    username: 'testuser',
    password: 'WrongPassword',
  };

  const nonexistentUser = {
    username: 'nonexistent',
    password: 'AnyPassword123!',
  };

  describe('TC-LOGIN-001: 有效凭证登录', () => {
    it('应成功登录并返回会话Token', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send(validUser)
        .expect(200);

      // 验证响应包含token
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe(validUser.username);
    });

    it('应设置安全的Cookie属性', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send(validUser)
        .expect(200);

      // 验证Set-Cookie头
      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();

      const cookie = Array.isArray(setCookieHeader) 
        ? setCookieHeader[0] 
        : setCookieHeader;

      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite');
    });

    it('应创建有效的会话标识符', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send(validUser)
        .expect(200);

      const token = response.body.token;
      
      // 验证token格式 (JWT示例)
      expect(token).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
    });
  });

  describe('TC-LOGIN-002: 无效密码登录', () => {
    it('应拒绝错误密码并返回401', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send(invalidUser)
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body).not.toHaveProperty('token');
    });

    it('不应泄露用户是否存在', async () => {
      // 不存在用户的响应应与错误密码响应相同
      const responseForInvalid = await request(app)
        .post('/api/auth/login')
        .send(invalidUser);

      const responseForNonexistent = await request(app)
        .post('/api/auth/login')
        .send(nonexistentUser);

      // 状态码应相同
      expect(responseForInvalid.status).toBe(responseForNonexistent.status);
      
      // 错误消息应相同(不区分用户不存在和密码错误)
      expect(responseForInvalid.body.error).toBe(responseForNonexistent.body.error);
    });
  });

  describe('TC-LOGIN-004: SQL注入防护', () => {
    it('应正确处理SQL注入尝试', async () => {
      const sqlInjectionPayloads = [
        "' OR '1'='1",
        "'; DROP TABLE users;--",
        "' UNION SELECT * FROM users--",
        "admin'--",
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            username: payload,
            password: payload,
          });

        // 应返回401而不是500(数据库错误)
        expect(response.status).toBe(401);
        
        // 不应包含数据库错误信息
        expect(response.body.error).not.toContain('SQL');
        expect(response.body.error).not.toContain('syntax');
        expect(response.body.error).not.toContain('database');
      }
    });
  });

  describe('TC-LOGIN-005: XSS注入防护', () => {
    it('应正确处理XSS尝试', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert("XSS")>',
        'javascript:alert("XSS")',
      ];

      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            username: payload,
            password: 'anypassword',
          });

        // 响应不应包含未转义的脚本
        const responseText = JSON.stringify(response.body);
        expect(responseText).not.toContain('<script>');
        expect(responseText).not.toContain('onerror=');
        expect(responseText).not.toContain('javascript:');
      }
    });
  });

  describe('TC-LOGIN-006: 输入验证', () => {
    it('应拒绝空用户名', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: '',
          password: 'ValidPass123!',
        })
        .expect(400);

      expect(response.body.error).toContain('username');
    });

    it('应拒绝空密码', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: '',
        })
        .expect(400);

      expect(response.body.error).toContain('password');
    });

    it('应处理超长输入', async () => {
      const longString = 'a'.repeat(10000);
      
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: longString,
          password: longString,
        });

      // 不应导致服务器错误
      expect(response.status).not.toBe(500);
    });
  });
});
