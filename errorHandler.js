// 404 Not Found Handler
const notFoundHandler = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    next(error);
  };
  
  // General Error Handler
  const errorHandler = (err, req, res, next) => {
    const statusCode = err.status || 500;
    const message = err.message || 'Internal Server Error';
  
    console.error({
      message: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString(),
    });
  
    res.status(statusCode).json({
      error: {
        message,
        status: statusCode,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
      },
    });
  };
  
  module.exports = { notFoundHandler, errorHandler };