"""异常处理与重试机制——可配置的重试策略，支持指数退避。
"""
from __future__ import annotations

import time
import functools
from dataclasses import dataclass
from typing import Callable, TypeVar, ParamSpec

P = ParamSpec("P")
T = TypeVar("T")


class RetryableError(RuntimeError):
    """可重试的错误类型（网络超时、API 限流等）"""
    pass


class NonRetryableError(RuntimeError):
    """不可重试的错误（鉴权失败、参数错误等）"""
    pass


@dataclass
class RetryConfig:
    """重试配置"""
    max_attempts: int = 3
    base_delay: float = 1.0       # 初始等待秒数
    max_delay: float = 30.0       # 最大等待秒数
    exponential_base: float = 2.0 # 指数退避基数
    retryable_exceptions: tuple = (RetryableError, TimeoutError, ConnectionError)

    def delay_for(self, attempt: int) -> float:
        """计算第 attempt 次重试的等待时间（从1开始）"""
        delay = self.base_delay * (self.exponential_base ** (attempt - 1))
        return min(delay, self.max_delay)


def retry_on_error(
    config: RetryConfig | None = None,
    *,
    on_retry: Callable[[Exception, int], None] | None = None,
) -> Callable:
    """装饰器：为函数添加可配置的重试逻辑

    用法：
        @retry_on_error(RetryConfig(max_attempts=3))
        def call_api():
            ...
    """
    cfg = config or RetryConfig()
    _T = TypeVar("_T")

    def decorator(fn: Callable[P, _T]) -> Callable[P, _T]:
        @functools.wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> _T:
            last_err: Exception | None = None
            for attempt in range(1, cfg.max_attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except cfg.retryable_exceptions as exc:
                    last_err = exc
                    if attempt == cfg.max_attempts:
                        break
                    delay = cfg.delay_for(attempt)
                    if on_retry:
                        on_retry(exc, attempt)
                    time.sleep(delay)
                except NonRetryableError:
                    raise
                except Exception as exc:
                    # 其他异常默认不重试
                    raise NonRetryableError(str(exc)) from exc
            raise RetryableError(f"重试 {cfg.max_attempts} 次后仍失败：{last_err}") from last_err
        return wrapper
    return decorator


def is_retryable(exc: Exception) -> bool:
    """判断一个异常是否应该重试"""
    return isinstance(exc, RetryableError) or isinstance(exc, (TimeoutError, ConnectionError))
