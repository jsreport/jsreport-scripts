define('scripts.model',["app", "core/basicModel", "jquery"], function (app, ModelBase, $) {
    return ModelBase.extend({
        odata: "scripts",
        url: "odata/scripts",

        toString: function() {
            return "Script " + (this.get("name") || "");
        }
    });
});


define('scripts.list.model',["app", "backbone", "core/dataGrid", "scripts.model"], function (app, Backbone, DataGrid, ScriptModel) {
    return Backbone.Collection.extend({

        url: function() {
            var qs =  this.filter.toOData();
            qs.$orderby = "modificationDate desc";
            return "odata/scripts?" + $.param(qs);
        },

        initialize: function () {
            var self = this;
            this.filter = new DataGrid.Filter.Base();
            this.filter.bind("apply", function () {
                self.fetch();
            });
        },
        
        parse: function (data) {
            if (this.meta && this.meta["@odata.count"])
                this.filter.set("totalCount", this.meta["@odata.count"]);

            return data;
        },

        model: ScriptModel
    });
});




define('scripts.list.view',["marionette", "core/dataGrid", "core/view.base"], function (Marionette, DataGrid, ViewBase) {
    return ViewBase.extend({
        template: "scripts-list",

        initialize: function () {
            this.listenTo(this.collection, "sync", this.render);
            this.listenTo(this.collection, "remove", this.render);
        },

        onDomRefresh: function () {
            this.dataGrid = DataGrid.show({
                collection: this.collection,
                filter: this.collection.filter,
                idKey: "shortid",
                onShowDetail: function (id) {
                    window.location.hash = "extension/scripts/detail/" + id;
                },
                el: $("#scriptsGridBox"),
                headerTemplate: "scripts-list-header",
                rowsTemplate: "scripts-list-rows"
            });
        }
    });
}); 
define('scripts.list.toolbar.view',["jquery", "app", "core/utils", "core/view.base", "underscore"],
    function($, app, Utils, LayoutBase) {
        return LayoutBase.extend({
            template: "scripts-list-toolbar",

            initialize: function() {
            },         
            
            events: {
                "click #deleteCommand": "deleteCommand"
            },

            deleteCommand: function() {
                this.contentView.dataGrid.deleteItems();
            }
        });
    });
define('scripts.template.standard.view',["app", "underscore", "marionette", "core/view.base", "core/utils"], function(app, _, Marionette, ViewBase, Utils) {
    return ViewBase.extend({
        tagName: "li",
        template: "scripts-template-standard",
         
        initialize: function() {
            _.bindAll(this, "isFilled", "getItems", "getItemsLength");
        },

        isFilled: function() {
            return this.model.get("shortid") || this.model.get("content");
        },
        
        getItems: function () {
            return this.model.items;
        },
        
        getItemsLength: function () {
            return this.model.items.length;
        },
        
        onClose: function() {
            this.model.templateModel.unbind("api-overrides", this.model.apiOverride, this.model);
        }
    });
});
define('scripts.template.standard.model',["app", "core/basicModel", "underscore"], function (app, ModelBase, _) {
   
    return ModelBase.extend({
        
        fetch: function (options) {
            var self = this;

            function processItems(items) {
                self.items = items;

                var script = self.templateModel.get("script");

                if (!script) {
                    script = {};

                    //back compatibility
                    if (self.templateModel.get("scriptId")) {
                        script.shortid = self.templateModel.get("scriptId");
                    }

                    self.templateModel.set("script", script, { silent: true});
                }

                var custom;
                if (app.options.scripts.allowCustom) {
                    custom = {name: "- custom -", shortid: "custom", content: script.content};
                    self.items.unshift(custom);
                }

                var empty = { name: "- not selected -", shortid: null };
                self.items.unshift(empty);

                if (!script.content && !script.shortid)
                    self.set(custom || empty, { silent: true });

                if (script.shortid)
                    self.set(_.findWhere(items, { shortid: script.shortid }), { silent: true });

                if (script.content)
                    self.set(custom || empty, { silent: true });

                return options.success();
            }

            if (app.options.scripts.allowSelection) {
                return app.dataProvider.get("odata/scripts").then(processItems);
            } else {
                processItems([]);
            }
        },

        setTemplate: function (templateModel) {
            this.templateModel = templateModel;
            this.listenTo(templateModel, "api-overrides", this.apiOverride);
        },
        
        apiOverride: function(req) {
             req.template.script = { shortid: this.get("shortid") || "...", content: '....' };
        },

        newCustomScript: function() {

        },
 
        initialize: function () {
            var self = this;
            this.listenTo(this, "change:shortid", function() {
                self.templateModel.get("script").shortid = self.get("shortid") !== "custom" ? self.get("shortid") : undefined;
                self.templateModel.get("script").content = self.get("shortid") === "custom" ? self.get("content") : undefined;
                self.set(_.findWhere(self.items, { shortid: self.get("shortid")}));
            });

            this.listenTo(this, "change:content", function() {
                if (self.get("shortid") === "custom") {
                    self.templateModel.get("script").content = self.get("content");
                    _.findWhere(self.items, { shortid: "custom" }).content = self.get("content");
                }
            });
        }
    });
});
define('scripts.detail.view',["marionette", "core/view.base", "core/aceBinder"], function(Marionette, ViewBase, aceBinder) {
    return ViewBase.extend({
        template: "scripts-detail",

        initialize: function() {
            this.listenTo(this.model, "sync", this.render);
        },

        onDomRefresh: function() {

            var top = $("#contentWrap").position().top;
            
            this.contentEditor = ace.edit("contentArea");
            this.contentEditor.setTheme("ace/theme/chrome");
            this.contentEditor.getSession().setMode("ace/mode/javascript");
            this.contentEditor.setOptions({
                enableBasicAutocompletion: true,
                enableSnippets: true
            });
                
            aceBinder(this.model, "content", this.contentEditor);
            
            $("#contentArea").css("margin-top", top);
        },

        validateLeaving: function() {
            return !this.model.hasChangesSyncLastSync();
        }
    });
});
define('scripts.toolbar.view',["jquery", "app", "marionette", "core/utils", "core/view.base"],
    function($, app, Marionette, Utils, LayoutBase) {
        return LayoutBase.extend({
            template: "scripts-toolbar",

            initialize: function() {
                $(document).on('keydown.script-detail', this.hotkey.bind(this));

                var self = this;
                this.listenTo(this, "render", function() {
                    var contextToolbar = {
                        name: "script-detail",
                        model: self.model,
                        region: self.extensionsToolbarRegion,
                        view: self
                    };
                    app.trigger("toolbar-render", contextToolbar);
                });
            },

            events: {
                "click #saveCommand": "save"
            },

            regions: {
                extensionsToolbarRegion: {
                    selector: "#extensionsToolbarBox",
                    regionType: Marionette.MultiRegion
                }
            },

            save: function() {
                if (!this.validate())
                    return;
                
                var self = this;
                this.model.save({}, {
                    success: function() {
                        app.trigger("script-saved", self.model);
                    }
                });
            },

            onDomRefresh: function() {
                var self = this;
            },

            hotkey: function(e) {
                if (e.ctrlKey && e.which === 83) {
                    this.save();
                    e.preventDefault();
                    return false;
                }
            },
            
            onValidate: function() {
                var res = [];
                
                if (this.model.get("name") == null || this.model.get("name") === "")
                    res.push({
                        message: "Name cannot be empty"
                    });
                 

                return res;
            },

            onClose: function() {
                $(document).off(".script-detail");
            }
        });
    });
define(["app", "marionette", "backbone",
        "scripts.list.model", "scripts.list.view", "scripts.list.toolbar.view",
        "scripts.model", "scripts.template.standard.view",
        "scripts.template.standard.model", "scripts.detail.view", "scripts.toolbar.view"],
    function (app, Marionette, Backbone, ScriptsListModel, ScriptsListView, ScriptsListToolbarView,
              ScriptsModel, StandardTemplateView, StandardTemplateModel, ScriptsDetailView, ToolbarView,
              entityRegistration) {

        app.options.scripts = app.options.scripts || { allowSelection: true , allowCustom: false};

        app.module("scripts", function (module) {

            var Router = Backbone.Router.extend({
                initialize: function () {
                    app.listenTo(app, "script-saved", function (model) {
                        window.location.hash = "/extension/scripts/detail/" + model.get("shortid");
                    });
                },

                routes: {
                    "extension/scripts/list": "scripts",
                    "extension/scripts/detail/:id": "scriptsDetail",
                    "extension/scripts/detail": "scriptsDetail"
                },

                scripts: function () {
                    this.navigate("/extension/scripts/list");

                    var model = new ScriptsListModel();

                    app.layout.showToolbarViewComposition(new ScriptsListView({ collection: model }), new ScriptsListToolbarView({ collection: model }));


                    model.fetch();
                },

                scriptsDetail: function (id) {
                    var model = new ScriptsModel();

                    app.layout.showToolbarViewComposition(new ScriptsDetailView({ model: model }), new ToolbarView({ model: model }));

                    if (id != null) {
                        model.set("shortid", id);
                        model.fetch();
                    }
                }
            });

            app.scripts.router = new Router();

            app.on("menu-render", function (context) {
                context.result += "<li><a href='#/extension/scripts/list'>Scripts</a></li>";
            });

            app.on("menu-actions-render", function (context) {
                context.result += "<li><a href='#/extension/scripts/detail'>Create Script</a></li>";
            });

            app.on("template-extensions-render", function (context) {
                var model = new StandardTemplateModel();
                model.setTemplate(context.template);

                model.fetch({
                    success: function () {
                        var view = new StandardTemplateView({ model: model });
                        context.extensionsRegion.show(view, "scripts");
                    }
                });
            });
        });
    });
