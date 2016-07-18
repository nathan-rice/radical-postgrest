/// <reference path="definitions/es6-shim/es6-shim.d.ts" />
/// <reference path="radical.ts" />

import radical = require("radical");

export interface IField {
    name?: string;
    primary?: boolean;
}

export class Field implements IField {
    protected inOperator = "in";
    protected isOperator = "is";
    protected eqOperator = "eq";
    protected notField: typeof Field = NotField;
    name: string;
    primary: boolean;
    not: Field;

    constructor(config?: IField) {
        this.configure(config);
    }

    protected configure(config?: IField) {
        if (config) {
            if (config.name) this.name = config.name;
            if (config.primary) this.primary = config.primary;
        }
        this.not = new this.notField(config);
        // Since the not property has to exist on the not-field, might as well make it semi-functional
        this.not.not = this;
    }

    protected predicate(operator, value) {
        return new Predicate({field: this.name, operator: operator, value: value});
    }

    in(value: any[]) {
        return this.predicate(this.inOperator, value.join(","));
    }

    is(value: boolean) {
        let strValue = value === null ? "null" : value.toString();
        return this.predicate(this.isOperator, strValue);
    }

    equals(value) {
        return this.predicate(this.eqOperator, value);
    }

    orderAscending() {
        return this.name + ".asc";
    };

    orderDescending() {
        return this.name + ".desc";
    };
}

class NotField extends Field {
    protected predicate(operator, value) {
        return new Predicate({field: this.name, operator: "not." + operator, value: value});
    }

    protected configure() {
        // Empty override to prevent infinite recursion
    }
}

export class TextField extends Field {
    protected likeOperator = "like";
    protected iLikeOperator = "ilike";
    protected fullTextSearchOperator = "@@";
    protected notField = NotTextField;
    not: NotTextField;

    like(value: string) {
        return this.predicate(this.likeOperator, value);
    }

    iLike(value: string) {
         return this.predicate(this.iLikeOperator, value);
    }

    fullTextSearch(value: string) {
        return this.predicate(this.fullTextSearchOperator, value);
    }
}

class NotTextField extends TextField {
    protected predicate(operator, value) {
        return new Predicate({field: this.name, operator: "not." + operator, value: value});
    }

    protected configure() {
        // Empty override to prevent infinite recursion
    }
}

export class NumericField extends Field {
    protected greaterThanOperator = "gt";
    protected lessThanOperator = "lt";
    protected greaterThanOrEqualToOperator = "gte";
    protected lessThanOrEqualToOperator = "lt";
    protected notField = NotNumericField;
    not: NotNumericField;

    greaterThan(value: number) {
        return this.predicate(this.greaterThanOperator, value);
    }

    lessThan(value: number) {
        return this.predicate(this.lessThanOperator, value);
    }

    greaterThanOrEqualTo(value: number) {
        return this.predicate(this.greaterThanOrEqualToOperator, value);
    }

    lessThanOrEqualTo(value: number) {
        return this.predicate(this.lessThanOrEqualToOperator, value);
    }
}

class NotNumericField extends NumericField {
    protected predicate(operator, value) {
        return new Predicate({field: this.name, operator: "not." + operator, value: value});
    }

    protected configure() {
        // Empty override to prevent infinite recursion
    }
}

interface IPredicate {
    field: string;
    operator: string;
    value: string;
}

class Predicate implements IPredicate {
    field: string;
    operator: string;
    value: string;

    constructor(config?: IPredicate) {
        if (config) {
            this.field = config.field;
            this.operator = config.operator;
            this.value = config.value;
        }
    }

    toUrlArgument() {
        return new radical.RequestArgument(this.field, this.operator + '.' + this.value);
    }
}

export interface IQuery {
    predicates?: Predicate[],
    limit?: number;
    offset?: number;
    orderBy?: string[];
}

export class Query implements IQuery {
    predicates: Predicate[] = [];
    limit: number;
    offset: number;
    orderBy: string[] = [];

    constructor(config?: IQuery) {
        if (config) {
            if (config.predicates) this.predicates = config.predicates;
            if (config.limit) this.limit = config.limit;
            if (config.offset) this.offset = config.offset;
            if (config.orderBy) this.orderBy = config.orderBy;
        }
    }

    urlArguments() {
        var ordering = this.orderingUrlArgument(), args = ordering ? [ordering] : [];
        this.predicates.forEach((predicate) => args.push(predicate.toUrlArgument()));
        return args;
    }

    protected orderingUrlArgument() {
        if (this.orderBy.length) {
            return {argument: "order", value: this.orderBy.join(",")}
        } else return null;
    }

    requestHeaders() {
        let headers = [], start, end;
        if (this.offset || this.limit) {
            start = this.offset || 0;
            end = this.limit ? start + this.limit : "";
            headers.push("Range: " + start + "-" + end);
        }
        return headers;
    }
}

export interface IModel {
    modelName?: string;
    fields?: Field[];
    index?: (instance: any) => any;
    factory?: (instance: any) => any;
}

export class Model {

    protected primary;
    modelName: string;

    constructor(config?: IModel) {
        this.configure(config);
    }

    configure(config?: IModel) {
        if (config) {
            if (config.modelName) this.modelName = config.modelName;
            if (config.index) this.index = config.index;
            if (config.factory) this.factory = config.factory;
            if (config.fields) {
                config.fields.forEach(field => {
                    if (field.name) this[field.name] = field
                });
            }
        }
        this.primary = [];
        for (let key in this) {
            if (this[key] instanceof Field) {
                if (!this[key].name) this[key].name = key;
                if (this[key].primary) {
                    this.primary.push({name: key, field: this[key]});
                }
            }
        }
        return this;
    }

    static create(config?: IModel) {
        return new this().configure(config);
    }

    index = (instance) => {
        if (!this.primary.length) {
            throw new Error("All models must have at least one primary field, or specify an index function");
        }
        var key = instance[this.primary[0].name];
        this.primary.slice(1).forEach(primary => key += ":" + instance[primary.name]);
        return key;
    };

    factory = (instance) => {
        return instance;
    };
}

interface ICrudAction extends radical.IAction {
    model?: Model;
}

class CollectionCrudAction extends radical.CollectionAction implements ICrudAction {
    model: Model;

    configure(config?: ICrudAction) {
        if (config) {
            if (config.model) this.model = config.model;
        }
        super.configure(config);
        return this;
    }

    reducer = (state, action) => {
        let instances = action.instances
            .map(this.model.factory)
            .reduce((instances, instance) => instances.set(this.model.index(instance), instance), state.get("instances"));
        return state.set("instances", instances);
    };

    static create(config?: ICrudAction) {
        return new this().configure(config);
    }
}


export class Create extends CollectionCrudAction {

    endpoint = radical.JsonEndpoint.create({
        method: "POST",
        headers: ['Prefer: return=representation']
    });

    initiator = function(action, objects) {
        action.endpoint.execute({
            data: objects,
            success: response => {
                action.getStore().dispatch({type: action.name, instances: response})
            }
        });
    };
 }

export class Read extends CollectionCrudAction {

    endpoint = radical.JsonEndpoint.create({
        headers: ['Range-Unit: items']
    });

    initiator = function(action, query?: IQuery) {
        let q = query instanceof Query ? query : new Query(query);
        action.endpoint.execute({
            headers: q.requestHeaders(),
            arguments: q.urlArguments(),
            success: response => {
                action.getStore().dispatch({type: action.name, instances: response})
            }
        });
    };
}

export class Update extends CollectionCrudAction {

    endpoint = radical.JsonEndpoint.create({
        method: "PUT",
        headers: ['Prefer: return=representation']
    });

    initiator = function(action, data, query?: IQuery) {
        let q = query instanceof Query ? query : new Query(query);
        action.endpoint.execute({
            data: data,
            headers: q.requestHeaders(),
            arguments: q.urlArguments(),
            success: response => {
                action.getStore().dispatch({type: action.name, instances: response})
            }
        });
    };
}

export class Delete extends CollectionCrudAction {

    endpoint = radical.JsonEndpoint.create({
        method: "DELETE",
        headers: ['Prefer: return=representation']
    });

    initiator = function(action, query?: IQuery) {
        let q = query instanceof Query ? query : new Query(query);
        action.endpoint.execute({
            headers: q.requestHeaders(),
            arguments: q.urlArguments(),
            success: response => {
                action.getStore().dispatch({type: action.name, instances: response})
            }
        });
    };

    reducer = (state, action) => {
        // The fact that we don't convert the returned json to an instance might cause issues with instanceKey
        let deletedIndices = new Set(action.instances.map(this.model.index)),
            instances = state.get("instances").filter(instance => deletedIndices.has(this.model.index(instance)));
        return state.set("instances", instances);
    }
}

export interface IDataService extends radical.INamespace {
    model?: Model;
    create?: CollectionCrudAction;
    read?: CollectionCrudAction;
    update?: CollectionCrudAction;
    delete?: CollectionCrudAction;
    url?: string;
}


export class CollectionDataService extends radical.CollectionNamespace implements IDataService {
    model: Model;
    create = Create.create({name: "create"});
    read = Read.create({name: "read"});
    update = Update.create({name: "update"});
    delete = Delete.create({name: "delete"});
    url: string = "/";

    configure(config?: IDataService) {
        if (config) {
            if (config.url) this.url = config.url;
            if (config.create) this.create = config.create;
            if (config.read) this.read = config.read;
            if (config.update) this.update = config.update;
            if (config.delete) this.delete = config.delete;
            if (config.model) this.model = config.model;
        }

        if (!this.url.endsWith("/")) this.url = this.url + "/";

        if (this.model) {
            this.reconfigureAction(this.create);
            this.reconfigureAction(this.read);
            this.reconfigureAction(this.update);
            this.reconfigureAction(this.delete);
        }

        super.configure(config);
        return this;
    }

    protected reconfigureAction(action) {
        let model = action.model || this.model;
        action.configure({
            model: model,
            name: model.modelName + ": " + action.name,
            endpoint: action.endpoint.configure({url: action.endpoint.url || (this.url + model.modelName)})
        });
    }

    instances() {
        return this.getState().get("instances");
    }
}