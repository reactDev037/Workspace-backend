'use strict';
var app = require('../');
var path = require('path');
var fs = require('fs-extra');
var expect = require('chai').expect;

var ComponentConfig = app.models.ComponentConfig;

describe('ComponentConfig', function() {
  beforeEach(givenBasicWorkspace);
  beforeEach(findComponentConfigs);

  it('should read data from "component-config.json"', function() {
    expect(this.componentConfigs).to.have.length(1);
    var explorer = this.componentConfigs[0];
    expect(explorer.configFile).to.equal('server/component-config.json');
    // see templates/components/api-server/template/server/component-config
    expect(explorer.name).to.equal('loopback-component-explorer');
    expect(explorer.value).to.eql({ mountPath: '/explorer' });
  });

  it('should write data to "component-config.json"', function() {
    var component = new ComponentConfig({
      facetName: 'server',
      name: 'loopback-component-foobar',
      value: {
        configKey: 'configValue'
      }
    });
    return component.save().then(function() {
      var cfgFile = path.resolve(SANDBOX, 'server', 'component-config.json');
      var data = fs.readJsonSync(cfgFile);
      expect(data).to.have.property('loopback-component-foobar');
      expect(data['loopback-component-foobar']).to.eql({
        configKey: 'configValue'
      });
    });
  });
});
