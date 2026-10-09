#!/bin/bash

# 会话管理测试运行脚本
# 用法: ./run-tests.sh [选项]
#   --all        运行所有测试
#   --functional 运行功能测试
#   --security   运行安全测试
#   --performance 运行性能测试
#   --boundary   运行边界测试
#   --integration 运行集成测试
#   --coverage   生成测试覆盖率报告

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # 无颜色

# 打印帮助信息
print_help() {
    echo -e "${BLUE}会话管理测试运行脚本${NC}"
    echo ""
    echo "用法:"
    echo "  ./run-tests.sh [选项]"
    echo ""
    echo "选项:"
    echo "  --all          运行所有测试 (默认)"
    echo "  --functional   运行功能测试"
    echo "  --security     运行安全测试"
    echo "  --performance  运行性能测试"
    echo "  --boundary     运行边界测试"
    echo "  --integration  运行集成测试"
    echo "  --coverage     生成测试覆盖率报告"
    echo "  --watch        监视模式"
    echo "  --verbose      详细输出"
    echo "  --help         显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  ./run-tests.sh --functional --verbose"
    echo "  ./run-tests.sh --all --coverage"
}

# 默认参数
RUN_ALL=true
RUN_FUNCTIONAL=false
RUN_SECURITY=false
RUN_PERFORMANCE=false
RUN_BOUNDARY=false
RUN_INTEGRATION=false
GENERATE_COVERAGE=false
WATCH_MODE=false
VERBOSE=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --all)
            RUN_ALL=true
            shift
            ;;
        --functional)
            RUN_FUNCTIONAL=true
            RUN_ALL=false
            shift
            ;;
        --security)
            RUN_SECURITY=true
            RUN_ALL=false
            shift
            ;;
        --performance)
            RUN_PERFORMANCE=true
            RUN_ALL=false
            shift
            ;;
        --boundary)
            RUN_BOUNDARY=true
            RUN_ALL=false
            shift
            ;;
        --integration)
            RUN_INTEGRATION=true
            RUN_ALL=false
            shift
            ;;
        --coverage)
            GENERATE_COVERAGE=true
            shift
            ;;
        --watch)
            WATCH_MODE=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            print_help
            exit 0
            ;;
        *)
            echo -e "${RED}未知选项: $1${NC}"
            print_help
            exit 1
            ;;
    esac
done

# 检查依赖
check_dependencies() {
    echo -e "${BLUE}检查依赖...${NC}"
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}错误: 未安装 Node.js${NC}"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}错误: 未安装 npm${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}依赖检查完成${NC}"
}

# 安装测试依赖
install_dependencies() {
    echo -e "${BLUE}安装测试依赖...${NC}"
    
    # 检查是否已安装 vitest
    if ! npm list vitest &> /dev/null; then
        echo "安装 vitest..."
        npm install --save-dev vitest
    fi
    
    # 检查是否已安装 supertest
    if ! npm list supertest &> /dev/null; then
        echo "安装 supertest..."
        npm install --save-dev supertest
    fi
    
    # 检查是否已安装 typescript 类型定义
    if ! npm list @types/supertest &> /dev/null; then
        echo "安装 @types/supertest..."
        npm install --save-dev @types/supertest
    fi
    
    echo -e "${GREEN}依赖安装完成${NC}"
}

# 运行测试的函数
run_tests() {
    local test_type=$1
    local test_path=$2
    local description=$3
    
    echo -e "${YELLOW}运行${description}...${NC}"
    
    local cmd="npx vitest run"
    
    if [ "$WATCH_MODE" = true ]; then
        cmd="npx vitest"
    fi
    
    if [ "$GENERATE_COVERAGE" = true ]; then
        cmd="$cmd --coverage"
    fi
    
    if [ "$VERBOSE" = true ]; then
        cmd="$cmd --reporter=verbose"
    fi
    
    cmd="$cmd $test_path"
    
    echo -e "${BLUE}执行: $cmd${NC}"
    
    if eval $cmd; then
        echo -e "${GREEN}${description}完成 ✓${NC}"
        return 0
    else
        echo -e "${RED}${description}失败 ✗${NC}"
        return 1
    fi
}

# 主函数
main() {
    echo -e "${BLUE}=== 会话管理测试套件 ===${NC}"
    echo ""
    
    check_dependencies
    install_dependencies
    
    # 记录测试结果
    declare -A test_results
    
    # 运行选择的测试
    if [ "$RUN_ALL" = true ] || [ "$RUN_FUNCTIONAL" = true ]; then
        if run_tests "functional" "tests/session/functional/*.test.ts" "功能测试"; then
            test_results[功能测试]="通过"
        else
            test_results[功能测试]="失败"
        fi
        echo ""
    fi
    
    if [ "$RUN_ALL" = true ] || [ "$RUN_SECURITY" = true ]; then
        if run_tests "security" "tests/session/security/*.test.ts" "安全测试"; then
            test_results[安全测试]="通过"
        else
            test_results[安全测试]="失败"
        fi
        echo ""
    fi
    
    if [ "$RUN_ALL" = true ] || [ "$RUN_PERFORMANCE" = true ]; then
        if run_tests "performance" "tests/session/performance/*.test.ts" "性能测试"; then
            test_results[性能测试]="通过"
        else
            test_results[性能测试]="失败"
        fi
        echo ""
    fi
    
    if [ "$RUN_ALL" = true ] || [ "$RUN_BOUNDARY" = true ]; then
        if run_tests "boundary" "tests/session/boundary/*.test.ts" "边界测试"; then
            test_results[边界测试]="通过"
        else
            test_results[边界测试]="失败"
        fi
        echo ""
    fi
    
    if [ "$RUN_ALL" = true ] || [ "$RUN_INTEGRATION" = true ]; then
        if run_tests "integration" "tests/session/integration/*.test.ts" "集成测试"; then
            test_results[集成测试]="通过"
        else
            test_results[集成测试]="失败"
        fi
        echo ""
    fi
    
    # 打印测试摘要
    echo -e "${BLUE}=== 测试摘要 ===${NC}"
    echo ""
    
    local all_passed=true
    
    for test_name in "${!test_results[@]}"; do
        local result=${test_results[$test_name]}
        if [ "$result" = "通过" ]; then
            echo -e "${GREEN}✓ $test_name: $result${NC}"
        else
            echo -e "${RED}✗ $test_name: $result${NC}"
            all_passed=false
        fi
    done
    
    echo ""
    
    if [ "$all_passed" = true ]; then
        echo -e "${GREEN}所有测试通过! 🎉${NC}"
        exit 0
    else
        echo -e "${RED}部分测试失败，请检查日志${NC}"
        exit 1
    fi
}

# 运行主函数
main
