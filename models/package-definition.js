var models = require('../app').models;
var PackageDefinition = models.PackageDefinition;
var ConfigFile = models.ConfigFile;

PackageDefinition.prototype.getUniqueId = function() {
  return this.name || null;
}

PackageDefinition.saveToFs = function(cache, packageDef, cb) {
  // TODO(bajtos) Move this method to WorkspaceEntity
  var configFile = new ConfigFile({
    path: PackageDefinition.getPath('.', packageDef),
    data: PackageDefinition.getConfigFromData(packageDef)
  });
  configFile.save(cb);
};
