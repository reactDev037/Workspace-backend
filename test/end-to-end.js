var async = require('async');
var exec = require('child_process').exec;
var extend = require('util')._extend;
var fs = require('fs-extra');
var install = require('strong-cached-install');
var mysql = require('mysql');
var path = require('path');
var request = require('supertest');
var debug = require('debug')('test:end-to-end');
var workspace = require('../app');
var models = workspace.models;
var TestDataBuilder = require('loopback-testing').TestDataBuilder;
var ref = TestDataBuilder.ref;

var Workspace = require('../app.js').models.Workspace;

var PKG_CACHE = path.resolve(__dirname, '.pkgcache');

// settings from bin/setup-mysql.js
var MYSQL_DATABASE = 'loopback_workspace_test';
var MYSQL_USER = 'lbws';
var MYSQL_PASSWORD = 'hbx42rec';

describe('end-to-end', function() {
  describe('api-server template', function() {
    var app;

    before(resetWorkspace);
    before(givenEmptySandbox);

    before(function createWorkspace(done) {
      givenWorkspaceFromTemplate('api-server', function(err) {
        debug('Created "api-server" in %s', SANDBOX);
        done(err);
      });
    });

    before(function createCustomModel(done) {
      models.ModelDefinition.create({
        facetName: 'common',
        name: 'Custom'
      }, done);
    });

    before(configureCustomModel);

    before(installSandboxPackages);

    before(function loadApp() {
      app = require(SANDBOX);
    });

    it('provides status on the root url', function(done) {
      request(app)
        .get('/')
        .expect(200, function(err, res) {
          if (err) done(err);
          expect(res.body).to.have.property('uptime');
          done();
        });
    });

    it('has authentication enabled', function(done) {
      request(app)
        .get('/api/users')
        .expect(401, done);
    });

    it('has favicon enabled', function(done) {
      request(app)
        .get('/favicon.ico')
        .expect(200, done);
    });

    it('can create and login a user', function(done) {
      var credentials = { email: 'test@example.com', password: 'pass' };
      var userId, tokenId;
      async.waterfall([
        function createUser(next) {
          request(app)
            .post('/api/users')
            .send(credentials)
            .expect(200, function(err, res) {
              if (err) return next(err);
              userId = res.body.id;
              debug('created user with id %s', userId);
              next();
            });
        },
        function login(next) {
          request(app)
            .post('/api/users/login')
            .send(credentials)
            .expect(200, function(err, res) {
              if (err) return next(err);
              tokenId = res.body.id;
              debug('obtained access token with id %s', tokenId);
              next();
            });
        },
        function getMyAccount(next) {
          request(app)
            .get('/api/users/' + userId)
            .set('Authorization', tokenId)
            .expect(200, function(err, res) {
              if (err) return next(err);
              debug('my account', res.body);
              expect(res.body.id, 'my user id').to.equal(userId);
              next();
            });
        }
      ], done);
    });

    it('passes scaffolded tests', function(done) {
      execNpm(['test'], { cwd: SANDBOX }, function(err, stdout, stderr) {
        done(err);
      });
    });
  });

  describe('autoupdate', function() {
    this.timeout(10000);
    var connection;
    before(function(done) {
      connection = setupConnection(done);
    });

    after(function closeConnection(done) {
      connection.end(done);
    });

    before(givenBasicWorkspace);

    before(configureMySQLDataSource);

    before(addMySQLConnector);

    before(installSandboxPackages);

    before(function createCustomModel(done) {
      models.ModelDefinition.create({
        facetName: 'common',
        name: 'Custom',
        options: {
          mysql: { table: 'CUSTOM' }
        }
      }, done);
    });

    before(configureCustomModel);

    beforeEach(function resetMysqlDatabase(done) {
      listTableNames(connection, function(err, tables) {
        if (err) return done(err);
        async.eachSeries(tables, function(name, cb) {
          connection.query('DROP TABLE ??', [name], cb);
        }, done);
      });
    });

    var db;
    beforeEach(function findDb(done) {
      models.DataSourceDefinition.findOne(
        { where: { name: 'db' } },
        function(err, ds) {
          db = ds;
          done(err);
        });
    });

    it('updates a single model in the database', function(done) {
      db.autoupdate('Custom', function(err) {
        if (err) done(err);
        listTableNames(connection, function(err, tables) {
          if (err) done(err);
          expect(tables).to.contain('CUSTOM');
          done();
        });
      });
    });

    it('updates all models in the database', function(done) {
      db.autoupdate(undefined, function(err) {
        if (err) done(err);
        listTableNames(connection, function(err, tables) {
          if (err) done(err);
          expect(tables).to.include.members(['CUSTOM', 'User', 'AccessToken']);
          done();
        });
      });
    });
  });

  describe('discovery', function() {
    this.timeout(10000);
    
    var connection;
    before(function(done) {
      connection = setupConnection(done);
    });

    after(function closeConnection(done) {
      connection.end(done);
    });

    before(givenBasicWorkspace);

    before(configureMySQLDataSource);

    before(addMySQLConnector);

    before(installSandboxPackages);

    before(function createTable(done) {
      var sql = fs.readFileSync(
        path.join(
          __dirname, 'sql', 'create-simple-table.sql'
        ),
        'utf8'
      );

      connection.query(sql, done);
    });

    var db;
    beforeEach(function findDb(done) {
      models.DataSourceDefinition.findOne(
        { where: { name: 'db' } },
        function(err, ds) {
          db = ds;
          done(err);
        });
    });

    describe('getSchema', function() {
      it('should include the simple table', function(done) {
        db.getSchema(function(err, schema) {
          if(err) return done(err);
          var tableNames = schema.map(function(item) { return item.name; });
          expect(tableNames).to.contain('simple');
          listTableNames(connection, function(err, tables) {
            if(err) return done(err);
            expect(tables.sort()).to.eql(tableNames.sort());
            done();
          });
        });
      });
    });

    describe('discoverModelDefinition', function() {
      it('should discover the simple table as a model', function(done) {
        db.discoverModelDefinition('simple', function(err, modelDefinition) {
          if(err) return done(err);
          expect(modelDefinition.name).to.equal('Simple');
          expect(modelDefinition.options.mysql.table).to.equal('simple');
          var props = Object.keys(modelDefinition.properties);
          expect(props.sort()).to.eql(['id', 'name', 'created'].sort());
          done();
        });
      });
    });
  });

  describe('testConnection', function() {
    var DataSourceDefinition = models.DataSourceDefinition;

    before(givenBasicWorkspace);

    before(addMySQLConnector);

    before(installSandboxPackages);

    beforeEach(function resetWorkspace(done) {
      // delete all non-default datasources to isolate individual tests
      // use `nlike` instead of `neq` as the latter is not implemented yet
      // https://github.com/strongloop/loopback-datasource-juggler/issues/265
      DataSourceDefinition.destroyAll({ name: { nlike: 'db' } }, done);
    });

    it('returns true for memory connector', function(done) {
      DataSourceDefinition.create(
        {
          facetName: 'server',
          name: 'test-memory-ds',
          connector: 'memory'
        },
        function(err, definition) {
          if (err) return done(err);
          definition.testConnection(function(err, connectionAvailable) {
            if (err) return done(err);
            expect(connectionAvailable).to.be.true;
            done();
          });
        }
      );
    });

    it('returns descriptive error for unknown connector', function(done) {
      DataSourceDefinition.create(
        {
          facetName: 'server',
          name: 'test-unknown-ds',
          connector: 'connector-that-does-not-exist',
        },
        function(err, definition) {
          if (err) return done(err);
          definition.testConnection(function(err) {
            expect(err, 'err').to.be.defined;
            expect(err.code, 'err.code').to.equal('ER_INVALID_CONNECTOR');
            expect(err.message, 'err.message')
              .to.contain('connector-that-does-not-exist');
            done();
          });
        });
    });

    it('returns error when the test crashes', function(done) {
      // db is a valid dataSource, the method is invalid causing a crash
      var ds = new DataSourceDefinition({ name: 'db' });
      ds.invokeMethodInWorkspace('nonExistingMethod', function(err) {
        expect(err).to.exist;
        // Node compat: v0.10.x (call method) or v0.11.x (read property)
        expect(err.message)
          .to.match(/Cannot (call method|read property) 'apply' of/);
        done();
      });
    });

    describe('MySQL', function() {
      it('returns true for valid config', function(done) {
        givenDataSource({}, function(err, definition) {
          if (err) return done(err);
          definition.testConnection(done);
        });
      });

      it('returns descriptive result for ECONNREFUSED', function(done) {
        givenDataSource(
          {
            port: 65000 // hopefully nobody is listening there
          },
          function(err, definition) {
            if (err) return done(err);
            definition.testConnection(function(err, status, pingError) {
              if (err) return done(err);
              expect(status, 'status').to.be.false;
              expect(pingError, 'pingError').to.exist;
              expect(pingError.code).to.equal('ECONNREFUSED');
              done();
            });
          });
      });

      it('returns descriptive error for invalid credentials', function(done) {
        givenDataSource(
          {
            password: 'invalid-password'
          },
          function(err, definition) {
            if (err) return done(err);
            definition.testConnection(function(err, status, pingError) {
              if (err) return done(err);
              expect(status, 'status').to.be.false;
              expect(pingError, 'pingError').to.exist;
              expect(pingError.code).to.equal('ER_ACCESS_DENIED_ERROR');
              done();
            });
          });
      });

      var dsid;
      function givenDataSource(config, cb) {
        config = extend({
          id: dsid,
          facetName: 'server',
          name: 'mysql',
          connector: 'mysql',
          port: null, // use default
          database: MYSQL_DATABASE,
          user: MYSQL_USER,
          password: MYSQL_PASSWORD
        }, config);

        DataSourceDefinition.updateOrCreate(config, function(err, dsd) {
          if (!err)
            dsid = dsd.id;
          cb(err, dsd);
        });
      }
    });
  });

  describe('start/stop/restart', function() {
    // See api-server template used by `givenBasicWorkspace`
    var APP_URL = 'http://localhost:3000';

    // The tests are forking new processes and setting up HTTP servers,
    // it requires more than 2 seconds to finish.
    this.timeout(10000);

    before(resetWorkspace);
    before(givenBasicWorkspace);
    before(installSandboxPackages);

    before(function addProductModel(done) {
      new TestDataBuilder()
        .define('productDef', models.ModelDefinition, {
          facetName: 'common',
          name: 'Product'
        })
        .define('productName', models.ModelProperty, {
          facetName: ref('productDef.facetName'),
          modelId: ref('productDef.id'),
          name: 'name',
          type: 'string',
        })
        .define('productConfig', models.ModelConfig, {
          facetName: 'server',
          name: ref('productDef.name'),
          dataSource: 'db'
        })
        .buildTo(this, done);
    });

    beforeEach(function killWorkspaceChild(done) {
      // This is depending on Workspace internals to keep the test code simple
      if (!Workspace._child) return done();
      Workspace._child.once('exit', function() { done(); });
      Workspace._child.kill();
    });

    it('starts the app in the workspace', function(done) {
      request(workspace).post('/api/workspaces/start')
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);
          expect(res.body).to.have.property('pid');
          request(APP_URL).get('/api/products')
            .expect(200)
            .end(done);
        });
    });

    it('stops the app started by the workspace', function(done) {
      models.Workspace.start(function(err) {
        if (err) return done(err);
        request(workspace).post('/api/workspaces/stop')
          .expect(200)
          .end(function(err) {
            if (err) return done(err);
            request(APP_URL).get('/api/products')
              .end(function(err) {
                expect(err).to.have.property('code', 'ECONNREFUSED');
                done();
              });
          });
      });
    });

    it('does not start more than one process', function(done) {
      models.Workspace.start(function(err, res) {
        if (err) return done(err);
        var pid = res.pid;
        models.Workspace.start(function(err, res) {
          if (err) return done(err);
          expect(res.pid).to.equal(pid);
          done();
        });
      });
    });

    it('allows stop to be called multiple times', function(done) {
      models.Workspace.start(function(err) {
        if (err) return done(err);
        models.Workspace.stop(function(err) {
          if (err) return done(err);
          models.Workspace.stop(function(err) {
            if (err) return done(err);
            // no assert, the test passed when we got here
            done();
          });
        });
      });
    });

    it('restarts the app', function(done) {
      models.Workspace.start(function(err, res) {
        if (err) return done(err);
        var pid = res.pid;

        request(workspace).post('/api/workspaces/restart')
          .expect(200)
          .end(function(err, res) {
            if (err) return done(err);
            expect(res.body.pid).to.be.a('number');
            expect(res.body.pid).to.not.equal(pid);
            done();
          });
      });
    });

    it('returns status for app not running', function(done) {
      request(workspace).get('/api/workspaces/is-running')
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);
          expect(res.body).to.eql({
            running: false
          });
          done();
        });
    });

    it('returns status for a running app', function(done) {
      models.Workspace.start(function(err, res) {
        if (err) return done(err);
        var pid = res.pid;

        request(workspace).get('/api/workspaces/is-running')
          .expect(200)
          .end(function(err, res) {
            if (err) return done(err);
            expect(res.body).to.eql({
              running: true,
              pid: pid
            });
            done();
          });
      });
    });
  });
});

function setupConnection(done) {
  var connection = mysql.createConnection({
    database: MYSQL_DATABASE,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD
  });

  connection.connect(function(err) {
    if (!err) return done(err);
    if (err.code === 'ECONNREFUSED') {
      err = new Error(
          'Cannot connect to local MySQL database, ' +
          'make sure you have `mysqld` running on your machine');
    } else {
      console.error();
      console.error('**************************************');
      console.error('Cannot connect to MySQL.');
      console.error('Setup the test environment by running');
      console.error('    node bin/setup-mysql');
      console.error('**************************************');
      console.error();
    }
    done(err);
  });

  return connection;
}

function execNpm(args, options, cb) {
  var debug = require('debug')('test:exec-npm');
  options = options || {};
  options.env = extend(
    {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
    },
    options.env
  );

  var command = 'npm ' + args.join(' ');
  debug(command);
  return exec(command, options, function(err, stdout, stderr) {
    debug('--npm stdout--\n%s\n--npm stderr--\n%s\n--end--',
      stdout, stderr);
    cb(err, stdout, stderr);
  });
}

function installSandboxPackages(cb) {
  this.timeout(300 * 1000);
  install(SANDBOX, PKG_CACHE, cb);
}

function listTableNames(connection, cb) {
  connection.query('SHOW TABLES', function(err, list, fields) {
    if (err) return cb(err);
    var tables = list.map(function(row) {
      // column name is e.g. 'Tables_in_loopback_workspace_test'
      return row[fields[0].name];
    });
    cb(null, tables);
  });
}

function configureMySQLDataSource(done) {
  models.DataSourceDefinition.findOne(
    { where: { name: 'db' } },
    function(err, ds) {
      if (err) return done(err);
      ds.connector = 'mysql';
      // settings prepared by bin/setup-mysql.js
      ds.database = MYSQL_DATABASE;
      ds.user = MYSQL_USER;
      ds.password = MYSQL_PASSWORD;
      ds.save(done);
    });
}

function addMySQLConnector(done) {
  models.PackageDefinition.findOne({}, function(err, pkg) {
    if (err) return done(err);
    pkg.dependencies['loopback-connector-mysql'] = '1.x';
    pkg.save(done);
  });
}

function configureCustomModel(done) {
  models.ModelConfig.create({
    name: 'Custom',
    dataSource: 'db',
    facetName: 'server'
  }, done);
}
