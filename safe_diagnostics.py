"""Fixed operation codes and exception classes only; never exception messages."""
import logging


def log_unexpected(operation, error):
    logging.getLogger('dompi.diagnostics').error(
        'operation=%s exception_type=%s', operation, type(error).__name__,
        exc_info=None, stack_info=False)
