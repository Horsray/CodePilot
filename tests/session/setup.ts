import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// 全局测试设置

// 模拟计时器
vi.useFakeTimers();

// 模拟 fetch
global.fetch = vi.fn();

// 模拟 localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

// 模拟 sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(global, 'sessionStorage', {
  value: sessionStorageMock,
});

// 模拟 crypto
const cryptoMock = {
  getRandomValues: vi.fn((array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  }),
  randomUUID: vi.fn(() => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  })),
};

Object.defineProperty(global, 'crypto', {
  value: cryptoMock,
});

// 模拟 TextEncoder/TextDecoder
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(text: string): Uint8Array {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i);
      }
      return bytes;
    }
  } as any;
}

if (typeof TextDecoder === 'undefined') {
  global.TextDecoder = class TextDecoder {
    decode(bytes: Uint8Array): string {
      return String.fromCharCode.apply(null, Array.from(bytes));
    }
  } as any;
}

// 全局 beforeAll
beforeAll(() => {
  console.log('开始会话管理测试套件');
  
  // 设置测试环境变量
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.SESSION_TIMEOUT = '3600';
});

// 全局 afterAll
afterAll(() => {
  console.log('会话管理测试套件完成');
  
  // 清理
  cleanup();
});

// 全局 beforeEach
beforeEach(() => {
  // 清除所有模拟
  vi.clearAllMocks();
  
  // 重置 localStorage
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
  
  // 重置 sessionStorage
  sessionStorageMock.getItem.mockClear();
  sessionStorageMock.setItem.mockClear();
  sessionStorageMock.removeItem.mockClear();
  sessionStorageMock.clear.mockClear();
  
  // 重置 fetch
  (global.fetch as any).mockClear();
  
  // 重置计时器
  vi.useFakeTimers();
});

// 全局 afterEach
afterEach(() => {
  // 清理
  cleanup();
  
  // 恢复真实计时器
  vi.useRealTimers();
  
  // 清除所有模拟
  vi.restoreAllMocks();
});

// 扩展 expect
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
  
  toHaveValidJwtStructure(received: string) {
    const parts = received.split('.');
    const pass = parts.length === 3;
    
    if (pass) {
      return {
        message: () => `expected ${received} not to have valid JWT structure`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to have valid JWT structure (header.payload.signature)`,
        pass: false,
      };
    }
  },
  
  toBeExpiredToken(received: string) {
    try {
      const parts = received.split('.');
      if (parts.length !== 3) {
        return {
          message: () => `expected ${received} to be a valid JWT`,
          pass: false,
        };
      }
      
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now() / 1000);
      const pass = payload.exp && payload.exp < now;
      
      if (pass) {
        return {
          message: () => `expected ${received} not to be expired`,
          pass: true,
        };
      } else {
        return {
          message: () => `expected ${received} to be expired`,
          pass: false,
        };
      }
    } catch (e) {
      return {
        message: () => `expected ${received} to be a valid JWT`,
        pass: false,
      };
    }
  },
});

// 类型扩展
declare global {
  namespace Vi {
    interface JestAssertion<T = any> {
      toBeWithinRange(floor: number, ceiling: number): T;
      toHaveValidJwtStructure(): T;
      toBeExpiredToken(): T;
    }
  }
}

// 测试工具函数
export const testUtils = {
  // 生成随机字符串
  randomString: (length: number = 10): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },
  
  // 生成随机邮箱
  randomEmail: (): string => {
    return `test${Date.now()}@example.com`;
  },
  
  // 生成随机用户名
  randomUsername: (): string => {
    return `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  },
  
  // 等待指定时间
  wait: (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  // 模拟延迟响应
  mockDelayedResponse: (response: any, delay: number = 100): Promise<any> => {
    return new Promise(resolve => {
      setTimeout(() => resolve(response), delay);
    });
  },
  
  // 检查对象是否包含所有必需字段
  hasRequiredFields: (obj: any, fields: string[]): boolean => {
    return fields.every(field => Object.hasOwnProperty.call(obj, field));
  },
  
  // 深度比较对象
  deepEqual: (obj1: any, obj2: any): boolean => {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return false;
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!testUtils.deepEqual(obj1[key], obj2[key])) return false;
    }
    
    return true;
  },
  
  // 生成测试用JWT token
  generateTestToken: (payload: any, secret: string = 'test-secret'): string => {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify(payload));
    const signature = btoa(`${encodedHeader}.${encodedPayload}.${secret}`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  },
  
  // 创建过期的测试token
  createExpiredToken: (payload: any = {}): string => {
    const expiredPayload = {
      ...payload,
      exp: Math.floor(Date.now() / 1000) - 3600, // 1小时前过期
      iat: Math.floor(Date.now() / 1000) - 7200, // 2小时前创建
    };
    return testUtils.generateTestToken(expiredPayload);
  },
  
  // 创建有效的测试token
  createValidToken: (payload: any = {}): string => {
    const validPayload = {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + 3600, // 1小时后过期
      iat: Math.floor(Date.now() / 1000), // 现在创建
    };
    return testUtils.generateTestToken(validPayload);
  },
};
