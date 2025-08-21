// Swagger JSDoc and UI setup for ChickSMS API
defineSwaggerDocs = () => {
  const swaggerJSDoc = require('swagger-jsdoc');
  const swaggerUi = require('swagger-ui-express');
  const express = require('express');
  const router = express.Router();

  const options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'ChickSMS API',
        version: '1.0.0',
        description: 'API documentation for ChickSMS service',
      },
      servers: [
        {
          url: 'http://localhost:3000',
        },
      ],
    },
    apis: ['./src/routes/*.js'], // Path to the API docs
  };

  let swaggerSpec = swaggerJSDoc(options);

  // Serve Swagger UI with dynamic server URL based on request
  router.use('/', swaggerUi.serve, (req, res, next) => {
    // Clone the spec to avoid mutating the original
    const spec = JSON.parse(JSON.stringify(swaggerSpec));
    const protocol = req.protocol;
    const host = req.get('host');
    spec.servers = [{ url: `${protocol}://${host}` }];
    swaggerUi.setup(spec)(req, res, next);
  });
  return router;
};

module.exports = defineSwaggerDocs();
